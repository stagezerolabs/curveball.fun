import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowIcon } from "../components/ArrowIcon";
import { LaunchPreview } from "../components/LaunchPreview";
import { UsdAmount } from "../components/UsdAmount";
import RubberSegment from "../components/RubberSegment";
import { useStore } from "../app/useStore.js";
import { useAccount, useReadContract } from "wagmi";
import { formatEther } from "viem";
import { curveLaunchpadAbi, erc20Abi } from "../sdk/contracts";
import {
  activeChainId,
  activeExplorerUrl,
  launchpadAddress,
} from "../lib/web3";
import {
  canSubmitLaunch,
  initialBuyFromWethBalance,
  percentToBps,
  type InitialBuyPercent,
} from "../lib/launchForm";
import { formatSignificantAmount } from "../lib/format.js";
import { publishTokenMetadata, uploadArtworkImage } from "../lib/artworkUpload";
import type { Navigate } from "../types";

type LaunchPhase =
  | "preparing"
  | "wrapWallet"
  | "wrapConfirming"
  | "approveWallet"
  | "approveConfirming"
  | "wallet"
  | "confirming"
  | "pending"
  | "success"
  | "error";
type LaunchProgress = {
  phase: LaunchPhase;
  hash: string | null;
  error: string;
} | null;
type ImageUpload = {
  file: File;
  status: "uploading" | "ready" | "error";
  cid?: string;
  error?: string;
};
type MetadataUpload = {
  file: File;
  name: string;
  symbol: string;
  status: "publishing" | "ready" | "error";
  uri?: string;
  error?: string;
};

const phaseCopy: Record<
  Exclude<LaunchPhase, "error">,
  { title: string; detail: string }
> = {
  preparing: {
    title: "Preparing launch",
    detail: "Checking details and network.",
  },
  wrapWallet: {
    title: "Wrap ETH",
    detail: "Confirm the deposit in your wallet.",
  },
  wrapConfirming: {
    title: "Wrapping ETH",
    detail: "Waiting for network confirmation.",
  },
  approveWallet: {
    title: "Approve WETH",
    detail: "Confirm the allowance in your wallet.",
  },
  approveConfirming: {
    title: "Approving WETH",
    detail: "Waiting for network confirmation.",
  },
  wallet: {
    title: "Confirm launch",
    detail: "Review and confirm in your wallet.",
  },
  confirming: {
    title: "Launch submitted",
    detail:
      "Your wallet submitted the launch transaction. Waiting for a network receipt.",
  },
  pending: {
    title: "Confirmation taking longer",
    detail:
      "RISE has not returned a receipt for this transaction. Check it in the explorer before trying the launch again.",
  },
  success: { title: "Token launched", detail: "Opening markets…" },
};

function sliderFill(value: string, max: number): React.CSSProperties {
  const fill = max > 0 ? (Number(value) / max) * 100 : 0;
  return {
    "--range-fill": `${Math.max(0, Math.min(100, fill))}%`,
  } as React.CSSProperties;
}

function displayWeth(amount: bigint): string {
  return formatSignificantAmount(Number(formatEther(amount)));
}

export function LaunchPage({ navigate }: { navigate: Navigate }) {
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const feeReviewConfirmed = useRef(false);
  const [draftName, setDraftName] = useState("");
  const [draftSymbol, setDraftSymbol] = useState("");
  const [draftTaxPercent, setDraftTaxPercent] = useState("0");
  const [selectedBuyPercent, setSelectedBuyPercent] =
    useState<InitialBuyPercent>(0);
  const [feeReviewOpen, setFeeReviewOpen] = useState(false);
  const [draftImageUrl, setDraftImageUrl] = useState<string>();
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [imageUpload, setImageUpload] = useState<ImageUpload | null>(null);
  const [metadataUpload, setMetadataUpload] = useState<MetadataUpload | null>(
    null,
  );
  const [imageRetry, setImageRetry] = useState(0);
  const [metadataRetry, setMetadataRetry] = useState(0);
  const [imageError, setImageError] = useState("");
  const { address } = useAccount();
  const { ready: privyReady, login } = usePrivy();
  const launchpadRead = {
    address: launchpadAddress ?? undefined,
    abi: curveLaunchpadAbi,
    chainId: activeChainId,
    query: { enabled: Boolean(launchpadAddress) },
  } as const;
  const { data: tokenSupply, isError: supplyError } = useReadContract({
    ...launchpadRead,
    functionName: "SUPPLY",
  });
  const { data: curveSupply } = useReadContract({
    ...launchpadRead,
    functionName: "CURVE_SUPPLY",
  });
  const { data: walletCapBps } = useReadContract({
    ...launchpadRead,
    functionName: "walletCapBps",
  });
  const { data: feeDefaults, isError: feeDefaultsError } = useReadContract({
    ...launchpadRead,
    functionName: "feeDefaults",
  });
  const { data: paused } = useReadContract({
    ...launchpadRead,
    functionName: "paused",
  });
  const { data: onchainLaunchFee, isError: launchFeeError } = useReadContract({
    ...launchpadRead,
    functionName: "launchFee",
  });
  const { data: quoteToken } = useReadContract({
    ...launchpadRead,
    functionName: "quoteToken",
  });
  const { data: wethBalance, isError: wethBalanceError } = useReadContract({
    address: quoteToken ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: activeChainId,
    query: {
      enabled: Boolean(quoteToken && address),
      refetchInterval: 15_000,
    },
  });
  const launchFee = onchainLaunchFee;
  const buybackShareBps = feeDefaults?.[2];
  const creatorTaxCapBps = feeDefaults?.[3];
  // The guardian's pause stops new launches (and buys); nothing else gates who may launch.
  const canCreate = Boolean(address) && paused === false;
  const {
    createToken: create,
    isPending,
    launchProgress,
    clearLaunchProgress,
  } = useStore() as {
    createToken: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
    isPending: boolean;
    launchProgress: LaunchProgress;
    clearLaunchProgress: () => void;
  };
  useEffect(() => {
    if (launchProgress) dialogHeading.current?.focus();
  }, [launchProgress?.phase]);
  useEffect(
    () => () => {
      if (draftImageUrl) URL.revokeObjectURL(draftImageUrl);
    },
    [draftImageUrl],
  );
  useEffect(() => {
    if (!artworkFile) return;
    const controller = new AbortController();
    let active = true;
    setImageUpload({ file: artworkFile, status: "uploading" });
    console.log("Uploading image to IPFS…");
    void uploadArtworkImage(artworkFile, { signal: controller.signal })
      .then((cid: string) => {
        if (active) {
          console.log("Image uploaded to IPFS.");
          setImageUpload({ file: artworkFile, status: "ready", cid });
        }
      })
      .catch((cause: unknown) => {
        if (active && !controller.signal.aborted)
          setImageUpload({
            file: artworkFile,
            status: "error",
            error:
              cause instanceof Error
                ? cause.message
                : "Artwork upload failed. Try again.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [artworkFile, imageRetry]);
  const nameForMetadata = draftName.trim();
  const symbolForMetadata = draftSymbol.trim().toUpperCase();
  const imageCid =
    imageUpload?.file === artworkFile && imageUpload.status === "ready"
      ? imageUpload.cid
      : undefined;
  const metadataDetailsValid =
    nameForMetadata.length > 0 &&
    new TextEncoder().encode(nameForMetadata).length <= 64 &&
    /^[A-Z0-9]{1,12}$/.test(symbolForMetadata);
  useEffect(() => {
    if (!artworkFile || !imageCid || !metadataDetailsValid) return;
    const controller = new AbortController();
    let active = true;
    setMetadataUpload({
      file: artworkFile,
      name: nameForMetadata,
      symbol: symbolForMetadata,
      status: "publishing",
    });
    const timer = window.setTimeout(() => {
      console.log("Publishing token metadata to IPFS…");
      void publishTokenMetadata(imageCid, {
        name: nameForMetadata,
        symbol: symbolForMetadata,
        signal: controller.signal,
      })
        .then((uri: string) => {
          if (active) {
            console.log("Token metadata published to IPFS.");
            setMetadataUpload({
              file: artworkFile,
              name: nameForMetadata,
              symbol: symbolForMetadata,
              status: "ready",
              uri,
            });
          }
        })
        .catch((cause: unknown) => {
          if (active && !controller.signal.aborted)
            setMetadataUpload({
              file: artworkFile,
              name: nameForMetadata,
              symbol: symbolForMetadata,
              status: "error",
              error:
                cause instanceof Error
                  ? cause.message
                  : "Token metadata upload failed. Try again.",
            });
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    artworkFile,
    imageCid,
    metadataDetailsValid,
    nameForMetadata,
    symbolForMetadata,
    metadataRetry,
  ]);
  const publishedUri =
    artworkFile &&
    metadataUpload?.file === artworkFile &&
    metadataUpload.name === nameForMetadata &&
    metadataUpload.symbol === symbolForMetadata &&
    metadataUpload.status === "ready"
      ? (metadataUpload.uri ?? "")
      : "";
  const artworkStatus = !artworkFile
    ? "idle"
    : imageUpload?.file !== artworkFile || imageUpload.status === "uploading"
      ? "uploading"
      : imageUpload.status === "error"
        ? "error"
        : !metadataDetailsValid
          ? "waiting"
          : metadataUpload?.file !== artworkFile ||
              metadataUpload.name !== nameForMetadata ||
              metadataUpload.symbol !== symbolForMetadata ||
              metadataUpload.status === "publishing"
            ? "publishing"
            : metadataUpload.status === "error"
              ? "error"
              : "ready";
  const artworkStatusMessage =
    artworkStatus === "error"
      ? imageUpload?.status === "error"
        ? imageUpload.error
        : metadataUpload?.error
      : undefined;
  useEffect(() => {
    if (launchProgress?.phase !== "success") return;
    setSelectedBuyPercent(0);
    setArtworkFile(null);
    setImageUpload(null);
    setMetadataUpload(null);
    setDraftImageUrl(undefined);
    if (imageInput.current) imageInput.current.value = "";
    const timer = window.setTimeout(() => {
      clearLaunchProgress();
      navigate("markets");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [launchProgress?.phase, navigate, clearLaunchProgress]);

  const phase = launchProgress?.phase;
  const noSpendableWeth =
    wethBalance !== undefined &&
    launchFee !== undefined &&
    wethBalance <= launchFee;
  const initialBuyWei =
    selectedBuyPercent === 0
      ? 0n
      : wethBalance === undefined || launchFee === undefined
        ? undefined
        : initialBuyFromWethBalance(wethBalance, launchFee, selectedBuyPercent);
  const draftInitialBuy =
    selectedBuyPercent === 0 || initialBuyWei === undefined
      ? ""
      : formatEther(initialBuyWei);
  const draftTaxBps = percentToBps(draftTaxPercent || "0") ?? 0;
  const taxCap = creatorTaxCapBps;
  const taxInvalid =
    draftTaxPercent.trim() !== "" &&
    (percentToBps(draftTaxPercent) === null ||
      (taxCap !== undefined && draftTaxBps > taxCap));
  const formReady =
    !imageError &&
    (selectedBuyPercent === 0 ||
      (initialBuyWei !== undefined && initialBuyWei > 0n)) &&
    canSubmitLaunch({
      name: draftName,
      symbol: draftSymbol,
      initialBuy: draftInitialBuy,
      launchFee,
      artworkUri: publishedUri,
      taxPercent: draftTaxPercent,
      taxCapBps: creatorTaxCapBps,
    });
  const submitLaunch = (event: React.FormEvent<HTMLFormElement>) => {
    if (!formReady || !canCreate) {
      event.preventDefault();
      return;
    }
    if (
      launchFee !== undefined &&
      launchFee > 0n &&
      !feeReviewConfirmed.current
    ) {
      event.preventDefault();
      setFeeReviewOpen(true);
      return;
    }
    feeReviewConfirmed.current = false;
    void create(event);
  };

  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size === 0 ||
      file.size > 2_000_000
    ) {
      setArtworkFile(null);
      setImageUpload(null);
      setMetadataUpload(null);
      setDraftImageUrl(undefined);
      setImageError("Choose a PNG, JPEG, or WebP image under 2 MB.");
      event.target.value = "";
      return;
    }
    setImageError("");
    setArtworkFile(file);
    setImageUpload(null);
    setMetadataUpload(null);
    setDraftImageUrl(URL.createObjectURL(file));
  };
  const retryArtwork = () => {
    if (imageUpload?.file === artworkFile && imageUpload.status === "error") {
      setImageUpload(null);
      setMetadataUpload(null);
      setImageRetry((attempt) => attempt + 1);
    } else {
      setMetadataUpload(null);
      setMetadataRetry((attempt) => attempt + 1);
    }
  };
  const removeImage = () => {
    setDraftImageUrl(undefined);
    setArtworkFile(null);
    setImageUpload(null);
    setMetadataUpload(null);
    setImageError("");
    if (imageInput.current) imageInput.current.value = "";
  };

  return (
    <main className="launch-page">
      <h1 id="launch-title" className="visually-hidden">
        Launch a token
      </h1>
      <section className="launch-layout" aria-labelledby="launch-title">
        <div className="launch-preview-column">
          <LaunchPreview
            name={draftName}
            symbol={draftSymbol}
            creatorTaxBps={draftTaxBps}
            walletCapBps={
              walletCapBps === undefined ? undefined : Number(walletCapBps)
            }
            buybackShareBps={
              buybackShareBps === undefined ? undefined : Number(buybackShareBps)
            }
            buybackUnavailable={feeDefaultsError}
            imageUrl={draftImageUrl}
            onChooseImage={() => imageInput.current?.click()}
            onRemoveImage={removeImage}
            supply={tokenSupply}
            curveSupply={curveSupply}
            supplyUnavailable={supplyError || !launchpadAddress}
          />
          {(artworkFile || imageError) && (
            <div className="launch-preview-upload-state">
              {artworkFile && artworkStatusMessage && (
                <p
                  id="launch-image-status"
                  className="launch-field-error"
                  role="alert"
                >
                  {artworkStatusMessage}
                </p>
              )}
              {artworkStatus === "error" && (
                <button
                  className="launch-remove-image"
                  type="button"
                  onClick={retryArtwork}
                >
                  Retry upload
                </button>
              )}
              {imageError && (
                <p
                  id="launch-image-error"
                  className="launch-field-error"
                  role="alert"
                >
                  {imageError}
                </p>
              )}
            </div>
          )}
        </div>
        <form ref={formRef} className="launch-form" onSubmit={submitLaunch}>
          <input
            ref={imageInput}
            className="visually-hidden"
            tabIndex={-1}
            name="artwork"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={selectImage}
            aria-label="Token artwork image"
            aria-describedby={[
              artworkFile && artworkStatusMessage && "launch-image-status",
              imageError && "launch-image-error",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={Boolean(imageError)}
          />
          <div className="launch-form-section">
            <div className="launch-form-group">
              <div className="launch-group-heading">
                <h2>Token details</h2>
              </div>
              <div className="launch-fields">
                <label className="launch-field-wide">
                  <span>Token name</span>
                  <input
                    name="name"
                    required
                    placeholder="Your token name"
                    autoComplete="off"
                    maxLength={64}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                </label>
                <label className="launch-field-wide">
                  <span>Ticker</span>
                  <span className="symbol-input">
                    <i>$</i>
                    <input
                      name="symbol"
                      required
                      placeholder="TOKEN"
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={12}
                      value={draftSymbol}
                      onChange={(event) => setDraftSymbol(event.target.value)}
                    />
                  </span>
                </label>
              </div>
            </div>

            <div className="launch-form-group launch-buy-group">
              <div className="launch-buy-field">
                <div className="launch-buy-heading">
                  <span>
                    Initial buy <small>Optional</small>
                  </span>
                  <strong>
                    {selectedBuyPercent === 0
                      ? "0"
                      : initialBuyWei === undefined
                        ? "…"
                        : displayWeth(initialBuyWei)}{" "}
                    WETH
                    {initialBuyWei !== undefined && (
                      <small className="launch-buy-usd">
                        ≈ <UsdAmount weth={Number(formatEther(initialBuyWei))} />
                      </small>
                    )}
                  </strong>
                </div>
                <RubberSegment
                  className="launch-buy-options"
                  aria-label="Initial buy using available WETH"
                  items={([0, 25, 50, 100] as const).map((percent) => ({
                    value: String(percent),
                    label:
                      percent === 0
                        ? "None"
                        : percent === 100
                          ? "Max"
                          : `${percent}%`,
                    disabled:
                      percent !== 0 &&
                      (wethBalance === undefined ||
                        launchFee === undefined ||
                        initialBuyFromWethBalance(
                          wethBalance,
                          launchFee,
                          percent,
                        ) === 0n),
                  }))}
                  value={String(selectedBuyPercent)}
                  onChange={(next) =>
                    setSelectedBuyPercent(Number(next) as InitialBuyPercent)
                  }
                  trackColor="var(--surface)"
                  thumbColor="var(--lime)"
                  textColor="var(--muted)"
                  activeTextColor="#10170f"
                  size="lg"
                  radius={9}
                  inset={4}
                  equalSlots
                  stretch={100}
                  squash={3}
                  speed={1}
                  glide={75}
                  draggable
                />
                <input
                  type="hidden"
                  name="initialBuy"
                  value={draftInitialBuy}
                />
                {address &&
                  (wethBalanceError ||
                    noSpendableWeth ||
                    wethBalance === undefined) && (
                    <small className="launch-buy-help" role="status">
                      {wethBalanceError
                        ? "Could not read your WETH balance."
                        : noSpendableWeth
                          ? "No WETH available for an initial buy."
                          : "Checking WETH balance…"}
                    </small>
                  )}
              </div>
            </div>

            <label className="launch-field-wide launch-range-field launch-tax-field">
              <span className="launch-range-heading">
                <span>Creator tax</span>
                <strong>{draftTaxPercent}%</strong>
              </span>
              <input
                type="range"
                min="0"
                max={Number(creatorTaxCapBps ?? 50) / 100}
                step="0.01"
                value={draftTaxPercent}
                style={sliderFill(
                  draftTaxPercent,
                  Number(creatorTaxCapBps ?? 50) / 100,
                )}
                disabled={creatorTaxCapBps === undefined}
                aria-invalid={taxInvalid}
                onChange={(event) => setDraftTaxPercent(event.target.value)}
              />
              {taxInvalid && (
                <small className="launch-field-error" role="alert">
                  Creator tax must be 0–
                  {Number(creatorTaxCapBps ?? 50) / 100}%.
                </small>
              )}
            </label>
            <input type="hidden" name="creatorTaxBps" value={draftTaxBps} />
            <input type="hidden" name="uri" value={publishedUri} />

            {address && paused === true && (
              <p className="notice" role="status">
                New launches are paused by the guardian. Existing markets keep
                trading.
              </p>
            )}
            {launchFeeError && (
              <p className="notice" role="alert">
                Could not verify the launch fee. Try again before launching.
              </p>
            )}
            {feeDefaultsError && (
              <p className="notice" role="alert">
                Could not read the launch limits. Retry before launching.
              </p>
            )}
            {launchFee === undefined && !launchFeeError && (
              <p className="launch-field-help" role="status">
                Checking launch fee…
              </p>
            )}
            <div className="launch-form-actions">
              <button
                className="launch-button"
                type={address ? "submit" : "button"}
                onClick={!address ? login : undefined}
                disabled={
                  !privyReady ||
                  isPending ||
                  (Boolean(address) && (!canCreate || !formReady))
                }
              >
                {isPending
                  ? "Launching…"
                  : !address
                    ? "Sign in to launch"
                    : artworkStatus === "uploading"
                      ? "Uploading artwork…"
                      : artworkStatus === "publishing"
                        ? "Publishing artwork…"
                        : artworkStatus === "error"
                          ? "Artwork unavailable"
                          : paused === true
                            ? "Launches paused"
                            : !canCreate
                              ? "Checking launch status…"
                              : !formReady
                                ? "Complete form to launch"
                                : "Launch token"}{" "}
                <ArrowIcon />
              </button>
            </div>
          </div>
        </form>
      </section>
      <Dialog.Root open={feeReviewOpen} onOpenChange={setFeeReviewOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="launch-modal-backdrop" />
          <Dialog.Popup className="launch-modal launch-fee-review dismissible">
            <Dialog.Close
              className="launch-modal-close"
              aria-label="Close fee review"
            >
              ×
            </Dialog.Close>
            <Dialog.Title>Review launch cost</Dialog.Title>
            <Dialog.Description>
              Launching a token includes an anti-spam fee paid in WETH.
            </Dialog.Description>
            <dl className="launch-fee-review-amounts">
              <div>
                <dt>Anti-spam fee</dt>
                <dd title={`${formatEther(launchFee ?? 0n)} WETH`}>
                  <UsdAmount weth={Number(formatEther(launchFee ?? 0n))} />
                  <small>{displayWeth(launchFee ?? 0n)} WETH</small>
                </dd>
              </div>
              {initialBuyWei !== undefined && initialBuyWei > 0n && (
                <div>
                  <dt>Initial buy</dt>
                  <dd title={`${formatEther(initialBuyWei)} WETH`}>
                    <UsdAmount weth={Number(formatEther(initialBuyWei))} />
                    <small>{displayWeth(initialBuyWei)} WETH</small>
                  </dd>
                </div>
              )}
              <div className="launch-fee-review-total">
                <dt>Total</dt>
                <dd
                  title={`${formatEther((launchFee ?? 0n) + (initialBuyWei ?? 0n))} WETH`}
                >
                  <UsdAmount
                    weth={Number(formatEther((launchFee ?? 0n) + (initialBuyWei ?? 0n)))}
                  />
                  <small>
                    {displayWeth((launchFee ?? 0n) + (initialBuyWei ?? 0n))} WETH
                  </small>
                </dd>
              </div>
            </dl>
            <div className="launch-fee-review-actions">
              <Dialog.Close className="launch-fee-review-cancel">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                className="launch-modal-action"
                disabled={!formReady || !canCreate || isPending}
                onClick={() => {
                  const form = formRef.current;
                  if (!form || !form.reportValidity()) return;
                  setFeeReviewOpen(false);
                  feeReviewConfirmed.current = true;
                  try {
                    form.requestSubmit();
                  } finally {
                    feeReviewConfirmed.current = false;
                  }
                }}
              >
                Continue to wallet
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={Boolean(launchProgress)}
        onOpenChange={(open) => {
          if (
            !open &&
            (phase === "error" || phase === "pending" || phase === "success")
          ) {
            clearLaunchProgress();
            if (phase === "success") navigate("markets");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="launch-modal-backdrop" />
          <Dialog.Popup
            className={`launch-modal ${phase === "error" || phase === "pending" || phase === "success" ? "dismissible" : ""}`}
          >
            {(phase === "error" ||
              phase === "pending" ||
              phase === "success") && (
              <Dialog.Close
                className="launch-modal-close"
                aria-label="Close launch status"
              >
                ×
              </Dialog.Close>
            )}
            {phase !== "error" &&
              phase !== "pending" &&
              phase !== "success" && (
                <span className="launch-modal-spinner" aria-hidden="true" />
              )}
            <Dialog.Title
              id="launch-modal-title"
              ref={dialogHeading}
              tabIndex={-1}
            >
              {phase === "error" ? "Launch stopped" : phaseCopy[phase!]?.title}
            </Dialog.Title>
            <Dialog.Description id="launch-modal-detail">
              {phase === "error"
                ? launchProgress?.error
                : phaseCopy[phase!]?.detail}
            </Dialog.Description>
            {launchProgress?.hash && (
              <a
                className="launch-tx-link"
                href={`${activeExplorerUrl}/tx/${launchProgress.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View transaction ↗
              </a>
            )}
            {phase === "error" && (
              <button
                type="button"
                className="launch-modal-action"
                onClick={clearLaunchProgress}
              >
                Back to form
              </button>
            )}
            {phase === "pending" && (
              <button
                type="button"
                className="launch-modal-action"
                onClick={clearLaunchProgress}
              >
                Close
              </button>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}

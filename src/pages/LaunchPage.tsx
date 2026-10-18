import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowIcon } from "../components/ArrowIcon";
import { LaunchPreview } from "../components/LaunchPreview";
import { useStore } from "../app/useStore.js";
import { useAccount, useReadContract } from "wagmi";
import { formatEther, parseEther } from "viem";
import { curveLaunchpadAbi } from "../sdk/contracts";
import { activeChainId, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { canSubmitLaunch, percentToBps } from "../lib/launchForm";
import { publishTokenMetadata, uploadArtworkImage } from "../lib/artworkUpload";
import type { Navigate } from "../types";

type LaunchPhase = "preparing" | "wrapWallet" | "wrapConfirming" | "approveWallet" | "approveConfirming" | "wallet" | "confirming" | "pending" | "success" | "error";
type LaunchProgress = { phase: LaunchPhase; hash: string | null; error: string } | null;
type ImageUpload = { file: File; status: "uploading" | "ready" | "error"; cid?: string; error?: string };
type MetadataUpload = { file: File; name: string; symbol: string; status: "publishing" | "ready" | "error"; uri?: string; error?: string };

const phaseCopy: Record<Exclude<LaunchPhase, "error">, { title: string; detail: string }> = {
  preparing: { title: "Preparing launch", detail: "Checking details and network." },
  wrapWallet: { title: "Wrap ETH", detail: "Confirm the deposit in your wallet." },
  wrapConfirming: { title: "Wrapping ETH", detail: "Waiting for network confirmation." },
  approveWallet: { title: "Approve WETH", detail: "Confirm the allowance in your wallet." },
  approveConfirming: { title: "Approving WETH", detail: "Waiting for network confirmation." },
  wallet: { title: "Confirm launch", detail: "Review and confirm in your wallet." },
  confirming: { title: "Launch submitted", detail: "Your wallet submitted the launch transaction. Waiting for a network receipt." },
  pending: { title: "Confirmation taking longer", detail: "RISE has not returned a receipt for this transaction. Check it in the explorer before trying the launch again." },
  success: { title: "Token launched", detail: "Opening markets…" },
};

export function LaunchPage({ navigate }: { navigate: Navigate }) {
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSymbol, setDraftSymbol] = useState("");
  const [draftTaxPercent, setDraftTaxPercent] = useState("0");
  const [draftReservePercent, setDraftReservePercent] = useState("4");
  const [draftInitialBuy, setDraftInitialBuy] = useState("");
  const [feeAccepted, setFeeAccepted] = useState(false);
  const [draftImageUrl, setDraftImageUrl] = useState<string>();
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [imageUpload, setImageUpload] = useState<ImageUpload | null>(null);
  const [metadataUpload, setMetadataUpload] = useState<MetadataUpload | null>(null);
  const [imageRetry, setImageRetry] = useState(0);
  const [metadataRetry, setMetadataRetry] = useState(0);
  const [imageError, setImageError] = useState("");
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const launchpadRead = { address: launchpadAddress ?? undefined, abi: curveLaunchpadAbi, chainId: activeChainId, query: { enabled: Boolean(launchpadAddress) } } as const;
  const { data: tokenSupply, isError: supplyError } = useReadContract({ ...launchpadRead, functionName: "SUPPLY" });
  const { data: curveSupply } = useReadContract({ ...launchpadRead, functionName: "CURVE_SUPPLY" });
  const { data: maxReserveBps, isError: reserveCapError } = useReadContract({ ...launchpadRead, functionName: "MAX_RESERVE_BPS" });
  const { data: feeDefaults, isError: feeDefaultsError } = useReadContract({ ...launchpadRead, functionName: "feeDefaults" });
  const { data: paused } = useReadContract({ ...launchpadRead, functionName: "paused" });
  const { data: onchainLaunchFee, isError: launchFeeError } = useReadContract({ ...launchpadRead, functionName: "launchFee" });
  const launchFee = onchainLaunchFee;
  const buybackShareBps = feeDefaults?.[2];
  const creatorTaxCapBps = feeDefaults?.[3];
  const maxReservePercent = maxReserveBps === undefined ? null : Number(maxReserveBps) / 100;
  // The guardian's pause stops new launches (and buys); nothing else gates who may launch.
  const canCreate = Boolean(address) && paused === false;
  const { createToken: create, isPending, launchProgress, clearLaunchProgress } = useStore() as {
    createToken: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
    isPending: boolean;
    launchProgress: LaunchProgress;
    clearLaunchProgress: () => void;
  };
  useEffect(() => {
    if (launchProgress) dialogHeading.current?.focus();
  }, [launchProgress?.phase]);
  useEffect(() => () => {
    if (draftImageUrl) URL.revokeObjectURL(draftImageUrl);
  }, [draftImageUrl]);
  useEffect(() => {
    if (!artworkFile) return;
    const controller = new AbortController();
    let active = true;
    setImageUpload({ file: artworkFile, status: "uploading" });
    void uploadArtworkImage(artworkFile, { signal: controller.signal })
      .then((cid: string) => {
        if (active) setImageUpload({ file: artworkFile, status: "ready", cid });
      })
      .catch((cause: unknown) => {
        if (active && !controller.signal.aborted) setImageUpload({ file: artworkFile, status: "error", error: cause instanceof Error ? cause.message : "Artwork upload failed. Try again." });
      });
    return () => { active = false; controller.abort(); };
  }, [artworkFile, imageRetry]);
  const nameForMetadata = draftName.trim();
  const symbolForMetadata = draftSymbol.trim().toUpperCase();
  const imageCid = imageUpload?.file === artworkFile && imageUpload.status === "ready" ? imageUpload.cid : undefined;
  const metadataDetailsValid = nameForMetadata.length > 0 && new TextEncoder().encode(nameForMetadata).length <= 64 && /^[A-Z0-9]{1,12}$/.test(symbolForMetadata);
  useEffect(() => {
    if (!artworkFile || !imageCid || !metadataDetailsValid) return;
    const controller = new AbortController();
    let active = true;
    setMetadataUpload({ file: artworkFile, name: nameForMetadata, symbol: symbolForMetadata, status: "publishing" });
    const timer = window.setTimeout(() => {
      void publishTokenMetadata(imageCid, { name: nameForMetadata, symbol: symbolForMetadata, signal: controller.signal })
        .then((uri: string) => {
          if (active) setMetadataUpload({ file: artworkFile, name: nameForMetadata, symbol: symbolForMetadata, status: "ready", uri });
        })
        .catch((cause: unknown) => {
          if (active && !controller.signal.aborted) setMetadataUpload({ file: artworkFile, name: nameForMetadata, symbol: symbolForMetadata, status: "error", error: cause instanceof Error ? cause.message : "Token metadata upload failed. Try again." });
        });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [artworkFile, imageCid, metadataDetailsValid, nameForMetadata, symbolForMetadata, metadataRetry]);
  const publishedUri = artworkFile && metadataUpload?.file === artworkFile && metadataUpload.name === nameForMetadata && metadataUpload.symbol === symbolForMetadata && metadataUpload.status === "ready"
    ? metadataUpload.uri ?? "" : "";
  const artworkStatus = !artworkFile ? "idle"
    : imageUpload?.file !== artworkFile || imageUpload.status === "uploading" ? "uploading"
    : imageUpload.status === "error" ? "error"
    : !metadataDetailsValid ? "waiting"
    : metadataUpload?.file !== artworkFile || metadataUpload.name !== nameForMetadata || metadataUpload.symbol !== symbolForMetadata || metadataUpload.status === "publishing" ? "publishing"
    : metadataUpload.status === "error" ? "error" : "ready";
  const artworkStatusMessage = artworkStatus === "uploading" ? "Uploading image to IPFS…"
    : artworkStatus === "waiting" ? "Add a token name and ticker to finish publishing artwork."
    : artworkStatus === "publishing" ? "Publishing token metadata to IPFS…"
    : artworkStatus === "ready" ? "Artwork ready on IPFS."
    : imageUpload?.status === "error" ? imageUpload.error : metadataUpload?.error;
  useEffect(() => {
    if (launchProgress?.phase !== "success") return;
    setFeeAccepted(false);
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
  const draftTaxBps = percentToBps(draftTaxPercent || "0") ?? 0;
  const draftReserveBps = percentToBps(draftReservePercent) ?? 0;
  const formReady = !imageError && canSubmitLaunch({
    name: draftName,
    symbol: draftSymbol,
    initialBuy: draftInitialBuy,
    launchFee,
    feeAccepted,
    artworkUri: publishedUri,
    taxPercent: draftTaxPercent,
    reservePercent: draftReservePercent,
    maxReserveBps: maxReserveBps === undefined ? undefined : Number(maxReserveBps),
    taxCapBps: creatorTaxCapBps,
  });
  let launchTotal: string | null = null;
  if (launchFee !== undefined && launchFee > 0n && draftInitialBuy.trim()) {
    try {
      const initialBuy = parseEther(draftInitialBuy);
      if (initialBuy > 0n) launchTotal = formatEther(launchFee + initialBuy);
    }
    catch { /* The number input will show its own validation error. */ }
  }
  const submitLaunch = (event: React.FormEvent<HTMLFormElement>) => {
    if (!formReady || !canCreate) {
      event.preventDefault();
      return;
    }
    void create(event);
  };

  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > 2_000_000) {
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

  return (
    <main className="launch-page">
      <h1 id="launch-title" className="visually-hidden">Launch a token</h1>
      <section className="launch-layout" aria-labelledby="launch-title">
        <LaunchPreview
          name={draftName}
          symbol={draftSymbol}
          creatorTaxBps={draftTaxBps}
          initialBuy={draftInitialBuy}
          imageUrl={draftImageUrl}
          supply={tokenSupply}
          curveSupply={curveSupply}
          reserveBps={draftReserveBps}
          supplyUnavailable={supplyError || !launchpadAddress}
        />
        <form className="launch-form" onSubmit={submitLaunch}>
          <div className="launch-form-section">
            <div className="launch-form-group">
              <div className="launch-group-heading">
                <h2>Token details</h2>
              </div>
              <label className="launch-image-upload">
                <input ref={imageInput} name="artwork" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} aria-describedby={["launch-image-help", artworkFile && "launch-image-status", imageError && "launch-image-error"].filter(Boolean).join(" ")} aria-invalid={Boolean(imageError)} />
                {draftImageUrl ? <img src={draftImageUrl} alt="" /> : <span className="launch-image-placeholder" aria-hidden="true">＋</span>}
                <span>{draftImageUrl ? "Change preview image" : "Choose an image"}</span>
              </label>
              <p id="launch-image-help" className="launch-field-help">PNG, JPEG, or WebP, under 2 MB.</p>
              {artworkFile && <div className="launch-upload-state">
                <p id="launch-image-status" className={artworkStatus === "error" ? "launch-field-error" : "launch-field-help"} role={artworkStatus === "error" ? "alert" : "status"}>{artworkStatusMessage}</p>
                {artworkStatus === "error" && <button className="launch-remove-image" type="button" onClick={retryArtwork}>Retry upload</button>}
              </div>}
              {(artworkFile || imageError) && <button className="launch-remove-image" type="button" onClick={() => {
                setDraftImageUrl(undefined);
                setArtworkFile(null);
                setImageUpload(null);
                setMetadataUpload(null);
                setImageError("");
                if (imageInput.current) imageInput.current.value = "";
              }}>Remove image</button>}
              {imageError && <p id="launch-image-error" className="launch-field-error" role="alert">{imageError}</p>}
              <div className="launch-fields">
                <label className="launch-field-wide">
                  <span>Token name</span>
                  <input name="name" required placeholder="Your token name" autoComplete="off" maxLength={64} value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                </label>
                <label className="launch-field-wide">
                  <span>Ticker</span>
                  <span className="symbol-input">
                    <i>$</i>
                    <input name="symbol" required placeholder="TOKEN" autoComplete="off" autoCapitalize="characters" maxLength={12} value={draftSymbol} onChange={(event) => setDraftSymbol(event.target.value)} />
                  </span>
                </label>
              </div>
            </div>

            <div className="launch-form-group">
              <div className="launch-pair-field">
                <span>Paired asset</span>
                <strong>WETH</strong>
              </div>
              <label className="launch-field-wide">
                <span>Initial buy <b>Optional</b></span>
                <span className="launch-unit-input">
                  <input name="initialBuy" type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={draftInitialBuy} onChange={(event) => setDraftInitialBuy(event.target.value)} aria-describedby="initial-buy-help" />
                  <i>WETH</i>
                </span>
                <small id="initial-buy-help">Buy from your own curve as part of the launch.</small>
              </label>
              {launchTotal !== null && <div className="launch-pair-field">
                <span>Maximum total (fee + initial buy limit)</span>
                <strong>{launchTotal} WETH</strong>
              </div>}
            </div>

            <details className="launch-advanced">
              <summary>Advanced options</summary>
              <div className="launch-advanced-fields">
                <label className="launch-field-wide">
                  <span>Creator tax <b>0–{Number(creatorTaxCapBps ?? 50) / 100}%</b></span>
                  <span className="launch-unit-input">
                    <input type="number" min="0" max={Number(creatorTaxCapBps ?? 50) / 100} step="0.01" inputMode="decimal" value={draftTaxPercent} onChange={(event) => setDraftTaxPercent(event.target.value)} />
                    <i>%</i>
                  </span>
                </label>
                <label className="launch-field-wide">
                  <span>Holder reserve <b>0–{maxReservePercent ?? "…"}%</b></span>
                  <span className="launch-unit-input">
                    <input name="holderReservePercent" type="number" min="0" max={maxReservePercent ?? undefined} step="0.01" inputMode="decimal" required value={draftReservePercent} onChange={(event) => setDraftReservePercent(event.target.value)} />
                    <i>%</i>
                  </span>
                  <small>After graduation, every curve buyer can claim a share in proportion to the tokens they bought on the curve. This reduces pool tokens, not curve sale tokens.</small>
                </label>
                {tokenSupply !== undefined && Number.isFinite(Number(draftReservePercent)) && <div className="launch-pair-field">
                  <span>Reserved tokens</span>
                  <strong>{(Number(formatEther(tokenSupply)) * Number(draftReservePercent) / 100).toLocaleString()}</strong>
                </div>}
                <div className="launch-pair-field">
                  <span>Buyback</span>
                  <strong>{buybackShareBps == null ? feeDefaultsError ? "Unavailable" : "Loading…" : `${Number(buybackShareBps) / 100}% of trading fee`}</strong>
                </div>
              </div>
            </details>
            <input type="hidden" name="creatorTaxBps" value={draftTaxBps} />
            <input type="hidden" name="holderReserveBps" value={draftReserveBps} />
            <input type="hidden" name="uri" value={publishedUri} />

            {address && paused === true && <p className="notice" role="status">New launches are paused by the guardian. Existing markets keep trading.</p>}
            {!artworkFile && <p className="launch-field-help" role="status">Add artwork to launch: it is published with the token's metadata.</p>}
            {launchFeeError && <p className="notice" role="alert">Could not verify the launch fee. Try again before launching.</p>}
            {(reserveCapError || feeDefaultsError) && <p className="notice" role="alert">Could not read the launch limits. Retry before launching.</p>}
            {launchFee === undefined && !launchFeeError && <p className="launch-field-help" role="status">Checking launch fee…</p>}
            {launchFee !== undefined && launchFee > 0n && (
              <label className="launch-fee-consent">
                <input type="checkbox" required checked={feeAccepted} onChange={(event) => setFeeAccepted(event.target.checked)} />
                <span>I agree to pay the anti-spam fee.</span>
              </label>
            )}
            <div className="launch-form-actions">
              <button
                className="launch-button"
                type={address ? "submit" : "button"}
                onClick={!address ? () => openConnectModal?.() : undefined}
                disabled={isPending || (Boolean(address) && (!canCreate || !formReady))}
              >
                {isPending ? "Launching…" : !address ? "Connect wallet to launch" : artworkStatus === "uploading" ? "Uploading artwork…" : artworkStatus === "publishing" ? "Publishing artwork…" : artworkStatus === "error" ? "Artwork unavailable" : paused === true ? "Launches paused" : !canCreate ? "Checking launch status…" : !formReady ? "Complete form to launch" : "Launch token"} <ArrowIcon />
              </button>
            </div>
          </div>
        </form>
      </section>
      <Dialog.Root open={Boolean(launchProgress)} onOpenChange={(open) => {
        if (!open && (phase === "error" || phase === "pending" || phase === "success")) {
          clearLaunchProgress();
          if (phase === "success") navigate("markets");
        }
      }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="launch-modal-backdrop" />
        <Dialog.Popup className={`launch-modal ${phase === "error" || phase === "pending" || phase === "success" ? "dismissible" : ""}`}>
          {(phase === "error" || phase === "pending" || phase === "success") && <Dialog.Close className="launch-modal-close" aria-label="Close launch status">×</Dialog.Close>}
          {phase !== "error" && phase !== "pending" && phase !== "success" && <span className="launch-modal-spinner" aria-hidden="true" />}
          <Dialog.Title id="launch-modal-title" ref={dialogHeading} tabIndex={-1}>{phase === "error" ? "Launch stopped" : phaseCopy[phase!]?.title}</Dialog.Title>
          <Dialog.Description id="launch-modal-detail">{phase === "error" ? launchProgress?.error : phaseCopy[phase!]?.detail}</Dialog.Description>
          {launchProgress?.hash && <a className="launch-tx-link" href={`${activeExplorerUrl}/tx/${launchProgress.hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
          {phase === "error" && <button type="button" className="launch-modal-action" onClick={clearLaunchProgress}>Back to form</button>}
          {phase === "pending" && <button type="button" className="launch-modal-action" onClick={clearLaunchProgress}>Close</button>}
        </Dialog.Popup>
      </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}

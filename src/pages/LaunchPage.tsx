import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@radix-ui/themes";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowIcon } from "../components/ArrowIcon";
import { LaunchPreview } from "../components/LaunchPreview";
import { useStore } from "../app/useStore.js";
import { useAccount, useReadContract } from "wagmi";
import { launchpadAbi } from "../sdk/contracts";
import { v2FactoryAbi } from "../sdk/v2Contracts";
import { activeChainId, activeContractVersion, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { getBetaReadEnabled, selectMarketState } from "../lib/marketState";
import { formatLaunchElapsed, launchMilestone, type LaunchPhase } from "../lib/launchProgress";
import type { Navigate } from "../types";

type LaunchProgress = { phase: LaunchPhase; hash: string | null; error: string } | null;

const phaseCopy: Record<Exclude<LaunchPhase, "error">, { title: string; detail: string }> = {
  preparing: { title: "Preparing launch", detail: "Checking details and network." },
  wrapWallet: { title: "Wrap ETH", detail: "Confirm the deposit in your wallet." },
  wrapConfirming: { title: "Wrapping ETH", detail: "Waiting for the wrap transaction to confirm on chain." },
  approveWallet: { title: "Approve WETH", detail: "Confirm the allowance in your wallet." },
  approveConfirming: { title: "Approving WETH", detail: "Waiting for the approval transaction to confirm on chain." },
  wallet: { title: "Confirm launch", detail: "Review and confirm in your wallet." },
  confirming: { title: "Launch submitted", detail: "Your launch transaction is on chain. Waiting for confirmation." },
  success: { title: "Token launched", detail: "Opening Markets…" },
};

export function LaunchPage({ navigate }: { navigate: Navigate }) {
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const launchStartedAt = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [draftName, setDraftName] = useState("");
  const [draftSymbol, setDraftSymbol] = useState("");
  const [draftTaxPercent, setDraftTaxPercent] = useState("0");
  const [draftInitialBuy, setDraftInitialBuy] = useState("");
  const [draftImageUrl, setDraftImageUrl] = useState<string>();
  const [imageError, setImageError] = useState("");
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const betaReadEnabled = getBetaReadEnabled({
    contractVersion: activeContractVersion,
    chainId: activeChainId,
    walletConnected: Boolean(address),
    hasLaunchpadAddress: Boolean(launchpadAddress),
  });
  const { data: publicOpen } = useReadContract({
    address: launchpadAddress ?? undefined, abi: activeContractVersion === "v2" ? v2FactoryAbi : launchpadAbi,
    functionName: "publicLaunchOpen", chainId: activeChainId,
    query: { enabled: betaReadEnabled.publicLaunchOpen },
  });
  const { data: invited } = useReadContract({
    address: launchpadAddress ?? undefined, abi: activeContractVersion === "v2" ? v2FactoryAbi : launchpadAbi,
    functionName: "invited", args: [address!], chainId: activeChainId,
    query: { enabled: betaReadEnabled.invited },
  });
  const { data: tokenSupply, isError: supplyError } = useReadContract({
    address: launchpadAddress ?? undefined,
    abi: activeContractVersion === "v2" ? v2FactoryAbi : launchpadAbi,
    functionName: "supply",
    chainId: activeChainId,
    query: { enabled: Boolean(launchpadAddress) },
  });
  const { data: buybackShareBps, isError: buybackError } = useReadContract({
    address: launchpadAddress ?? undefined,
    abi: v2FactoryAbi,
    functionName: "buybackShareBps",
    chainId: activeChainId,
    query: { enabled: activeContractVersion === "v2" && Boolean(launchpadAddress) },
  });
  const { data: creatorTaxCapBps } = useReadContract({
    address: launchpadAddress ?? undefined,
    abi: v2FactoryAbi,
    functionName: "creatorTaxCapBps",
    chainId: activeChainId,
    query: { enabled: activeContractVersion === "v2" && Boolean(launchpadAddress) },
  });
  const { canCreate } = selectMarketState({
    contractVersion: activeContractVersion,
    chainId: activeChainId,
    walletConnected: Boolean(address),
    publicLaunchOpen: publicOpen,
    invited,
  });
  const { createToken: create, isPending, launchProgress, clearLaunchProgress } = useStore() as {
    createToken: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
    isPending: boolean;
    launchProgress: LaunchProgress;
    clearLaunchProgress: () => void;
  };
  const launchOpen = Boolean(launchProgress);
  useEffect(() => {
    if (!launchOpen) {
      launchStartedAt.current = null;
      setElapsedSeconds(0);
      return;
    }
    launchStartedAt.current ??= Date.now();
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - launchStartedAt.current!) / 1000));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [launchOpen]);
  useEffect(() => {
    if (launchProgress) dialogHeading.current?.focus();
  }, [launchProgress?.phase]);
  useEffect(() => () => {
    if (draftImageUrl) URL.revokeObjectURL(draftImageUrl);
  }, [draftImageUrl]);
  useEffect(() => {
    if (launchProgress?.phase !== "success") return;
    const timer = window.setTimeout(() => {
      clearLaunchProgress();
      navigate("markets");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [launchProgress?.phase, navigate, clearLaunchProgress]);

  const phase = launchProgress?.phase;
  const step = launchMilestone(phase);
  const draftTaxBps = Math.round(Number(draftTaxPercent || "0") * 100);
  const submitLaunch = (event: React.FormEvent<HTMLFormElement>) => {
    if (draftImageUrl) {
      event.preventDefault();
      setImageError("Artwork publishing is not connected yet. Remove the image to launch without artwork.");
      return;
    }
    void create(event);
  };

  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2_000_000) {
      setImageError("Choose a PNG, JPEG, or WebP image under 2 MB.");
      event.target.value = "";
      return;
    }
    setImageError("");
    setDraftImageUrl(URL.createObjectURL(file));
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
          showV2Options={activeContractVersion === "v2"}
          supply={tokenSupply}
          supplyUnavailable={supplyError || !launchpadAddress}
        />
        <form className="launch-form" onSubmit={submitLaunch}>
          <div className="launch-form-section">
            <div className="launch-form-group">
              <div className="launch-group-heading">
                <h2>Token details</h2>
              </div>
              <label className="launch-image-upload">
                <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} aria-describedby={imageError ? "launch-image-help launch-image-error" : "launch-image-help"} aria-invalid={Boolean(imageError)} />
                {draftImageUrl ? <img src={draftImageUrl} alt="" /> : <span className="launch-image-placeholder" aria-hidden="true">＋</span>}
                <span>{draftImageUrl ? "Change preview image" : "Choose an image"}</span>
              </label>
              <p id="launch-image-help" className="launch-field-help">PNG, JPEG, or WebP, under 2 MB.</p>
              {draftImageUrl && <button className="launch-remove-image" type="button" onClick={() => {
                setDraftImageUrl(undefined);
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
              {activeContractVersion === "v2" && (
                <label className="launch-field-wide">
                  <span>Initial buy <b>Optional</b></span>
                  <span className="launch-unit-input">
                    <input name="initialBuy" type="number" min="0" step="any" inputMode="decimal" placeholder="0" value={draftInitialBuy} onChange={(event) => setDraftInitialBuy(event.target.value)} aria-describedby="initial-buy-help" />
                    <i>WETH</i>
                  </span>
                  <small id="initial-buy-help">Buy from your own curve as part of the launch.</small>
                </label>
              )}
            </div>

            {activeContractVersion === "v2" && <details className="launch-advanced">
              <summary>Advanced options</summary>
              <div className="launch-advanced-fields">
                <label className="launch-field-wide">
                  <span>Creator tax <b>0–{Number(creatorTaxCapBps ?? 50) / 100}%</b></span>
                  <span className="launch-unit-input">
                    <input type="number" min="0" max={Number(creatorTaxCapBps ?? 50) / 100} step="0.01" inputMode="decimal" value={draftTaxPercent} onChange={(event) => setDraftTaxPercent(event.target.value)} />
                    <i>%</i>
                  </span>
                </label>
                <div className="launch-pair-field">
                  <span>Buyback</span>
                  <strong>{buybackShareBps == null ? buybackError ? "Unavailable" : "Loading…" : `${Number(buybackShareBps) / 100}% of trading fee`}</strong>
                </div>
              </div>
            </details>}
            <input type="hidden" name="creatorTaxBps" value={draftTaxBps} />
            <input type="hidden" name="uri" value="" />

            {address && !canCreate && <p className="notice" role="status">{publicOpen === false && invited === false ? "This factory is invite-only." : "Checking launch access…"}</p>}
            <div className="launch-form-actions">
              <Button
                className="launch-button"
                type={address ? "submit" : "button"}
                size="3"
                onClick={!address ? () => openConnectModal?.() : undefined}
                disabled={isPending || (Boolean(address) && !canCreate)}
              >
                {isPending ? "Launching…" : !address ? "Connect wallet to launch" : !canCreate ? "Checking access…" : "Launch token"} <ArrowIcon />
              </Button>
            </div>
          </div>
        </form>
      </section>
      <Dialog.Root open={Boolean(launchProgress)} onOpenChange={(open) => {
        if (!open && (phase === "error" || phase === "success")) {
          clearLaunchProgress();
          if (phase === "success") navigate("markets");
        }
      }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="launch-modal-backdrop" />
        <Dialog.Popup className={`launch-modal ${phase === "error" || phase === "success" ? "dismissible" : ""}`}>
          {(phase === "error" || phase === "success") && <Dialog.Close className="launch-modal-close" aria-label="Close launch status">×</Dialog.Close>}
          <div className="launch-modal-meta">
            <span className="launch-modal-kicker">{phase === "error" ? "Launch interrupted" : phase === "success" ? "Complete" : `Step ${step + 1} of 4`}</span>
            <time className="launch-modal-timer" dateTime={`PT${elapsedSeconds}S`} aria-label={`${formatLaunchElapsed(elapsedSeconds)} elapsed`}>{formatLaunchElapsed(elapsedSeconds)} elapsed</time>
          </div>
          <Dialog.Title id="launch-modal-title" ref={dialogHeading} tabIndex={-1}>{phase === "error" ? "Launch stopped" : phaseCopy[phase!]?.title}</Dialog.Title>
          <Dialog.Description id="launch-modal-detail">{phase === "error" ? launchProgress?.error : phaseCopy[phase!]?.detail}</Dialog.Description>
          {phase !== "error" && <ol className="launch-steps" aria-label="Launch progress">
            {["Prepare", "Confirm in wallet", "Confirm on chain", "List in Markets"].map((label, index) => <li key={label} className={index < step ? "done" : index === step ? "current" : ""} aria-current={index === step ? "step" : undefined}><span aria-hidden="true">{index < step ? "✓" : index === step ? <i className="launch-step-spinner" /> : String(index + 1).padStart(2, "0")}</span>{label}</li>)}
          </ol>}
          {launchProgress?.hash && <a className="launch-tx-link" href={`${activeExplorerUrl}/tx/${launchProgress.hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
          {phase === "error" && <button type="button" className="launch-modal-action" onClick={clearLaunchProgress}>Try again</button>}
          {phase === "success" && <button type="button" className="launch-modal-action" onClick={() => { clearLaunchProgress(); navigate("markets"); }}>View in Markets <ArrowIcon /></button>}
        </Dialog.Popup>
      </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}

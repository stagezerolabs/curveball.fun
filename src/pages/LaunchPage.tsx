import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@radix-ui/themes";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowIcon } from "../components/ArrowIcon";
import { ChoiceSelect } from "../components/ChoiceSelect";
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
  const [formStep, setFormStep] = useState<1 | 2>(1);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const formStepHeading = useRef<HTMLHeadingElement>(null);
  const tokenNameInput = useRef<HTMLInputElement>(null);
  const tokenSymbolInput = useRef<HTMLInputElement>(null);
  const launchStartedAt = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  useEffect(() => {
    formStepHeading.current?.focus();
  }, [formStep]);
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
  const showLaunchSettings = () => {
    if (!tokenNameInput.current?.reportValidity()) return;
    if (!tokenSymbolInput.current?.reportValidity()) return;
    setFormStep(2);
  };
  const submitLaunch = (event: React.FormEvent<HTMLFormElement>) => {
    if (formStep === 1) {
      event.preventDefault();
      showLaunchSettings();
      return;
    }
    void create(event);
  };

  return (
    <main className="launch-page">
      <section className="launch-layout" aria-labelledby={`launch-title-${formStep}`}>
        <form className={`launch-form launch-form-step-${formStep}`} onSubmit={submitLaunch}>
          <header className="launch-wizard-bar">
            <ol className="launch-stepper" aria-label="Launch steps">
              <li className={formStep === 1 ? "current" : "done"} aria-current={formStep === 1 ? "step" : undefined}>
                <span>01</span>
                <strong>Details</strong>
              </li>
              <li className={formStep === 2 ? "current" : ""} aria-current={formStep === 2 ? "step" : undefined}>
                <span>02</span>
                <strong>Settings</strong>
              </li>
            </ol>
          </header>

          <div className="launch-form-section" hidden={formStep !== 1}>
            <div className="form-heading">
              <h1 id="launch-title-1" ref={formStep === 1 ? formStepHeading : undefined} tabIndex={-1}>Token details</h1>
              <p>Give your token a name and ticker. You can review everything before launching.</p>
            </div>
            <div className="launch-fields">
              <label>
                <span>Token name</span>
                <input
                  ref={tokenNameInput}
                  name="name"
                  required
                  placeholder="Curveball"
                  autoComplete="off"
                  maxLength={64}
                />
              </label>
              <label>
                <span>Symbol</span>
                <span className="symbol-input">
                  <i>$</i>
                  <input ref={tokenSymbolInput} name="symbol" required placeholder="CURVE" autoComplete="off" autoCapitalize="characters" maxLength={12} />
                </span>
              </label>
              <label className="launch-field-wide">
                <span>Metadata URL <b>Optional</b></span>
                <input name="uri" type="url" placeholder="https://example.com/token.json" autoComplete="url" />
                <small>Link to a JSON file with your token image and description.</small>
              </label>
            </div>
            <div className="launch-form-actions">
              <Button className="launch-button" type="button" size="3" onClick={showLaunchSettings}>Continue <ArrowIcon /></Button>
            </div>
          </div>

          <div className="launch-form-section launch-settings" hidden={formStep !== 2}>
            <div className="form-heading">
              <h1 id="launch-title-2" ref={formStep === 2 ? formStepHeading : undefined} tabIndex={-1}>Launch settings</h1>
              <p>Choose how your token starts trading.</p>
            </div>
            {activeContractVersion === "v2" && <div className="launch-fields launch-settings-fields">
                <div className="launch-select-field">
                  <span>Creator tax <b>Optional</b></span>
                  <ChoiceSelect name="creatorTaxBps" label="Creator tax" defaultValue="0" options={[
                    { value: "0", label: "No creator tax" },
                    { value: "10", label: "0.1%" },
                    { value: "25", label: "0.25%" },
                    { value: "50", label: "0.5% maximum" },
                  ]} />
                </div>
                <label>
                  <span>Initial buy <b>Optional</b></span>
                  <span className="launch-unit-input">
                    <input name="initialBuy" type="number" min="0" step="any" inputMode="decimal" placeholder="0" />
                    <i>WETH</i>
                  </span>
                </label>
              </div>}
            {address && !canCreate && <p className="notice" role="status">{publicOpen === false && invited === false ? "This factory is invite-only." : "Checking launch access…"}</p>}
            <div className="launch-form-actions split">
              <Button variant="outline" className="launch-back-button" type="button" size="3" onClick={() => setFormStep(1)}>Back</Button>
              <Button
                className="launch-button"
                type={address ? "submit" : "button"}
                size="3"
                onClick={!address ? () => openConnectModal?.() : undefined}
                disabled={isPending || (Boolean(address) && !canCreate)}
              >
                {isPending ? "Launching…" : !address ? "Connect wallet" : !canCreate ? "Checking access…" : "Launch token"} <ArrowIcon />
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

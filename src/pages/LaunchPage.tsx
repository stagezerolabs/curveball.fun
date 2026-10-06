import { useEffect, useRef } from "react";
import { ArrowIcon } from "../components/ArrowIcon";
import { useStore } from "../app/useStore.js";
import { useAccount, useReadContract } from "wagmi";
import { launchpadAbi } from "../sdk/contracts";
import { v2FactoryAbi } from "../sdk/v2Contracts";
import { activeChainId, activeContractVersion, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { getBetaReadEnabled, selectMarketState } from "../lib/marketState";
import type { Navigate } from "../types";

type LaunchPhase = "preparing" | "wrapWallet" | "wrapConfirming" | "approveWallet" | "approveConfirming" | "wallet" | "confirming" | "indexing" | "success" | "error";
type LaunchProgress = { phase: LaunchPhase; hash: string | null; error: string } | null;

const phaseCopy: Record<Exclude<LaunchPhase, "error">, { title: string; detail: string }> = {
  preparing: { title: "Preparing your launch", detail: "Checking the token details and your wallet network." },
  wrapWallet: { title: "Wrap ETH for your initial buy", detail: "Confirm the WETH deposit in your wallet." },
  wrapConfirming: { title: "Wrapping ETH", detail: "Waiting for the deposit to confirm on chain." },
  approveWallet: { title: "Approve your initial buy", detail: "Confirm the WETH allowance in your wallet." },
  approveConfirming: { title: "Confirming approval", detail: "Waiting for the allowance to confirm on chain." },
  wallet: { title: "Confirm your launch", detail: "Review and confirm the token creation in your wallet." },
  confirming: { title: "Transaction submitted", detail: "Your launch is on its way. Waiting for on-chain confirmation." },
  indexing: { title: "Your token is live", detail: "The transaction confirmed. Adding your token to the markets list." },
  success: { title: "Launch complete", detail: "Your token is in Markets. Taking you there now…" },
};

export function LaunchPage({ navigate }: { navigate: Navigate }) {
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const { address } = useAccount();
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
  useEffect(() => {
    if (launchProgress) dialogHeading.current?.focus();
  }, [launchProgress?.phase]);
  useEffect(() => {
    if (launchProgress?.phase !== "success") return;
    const timer = window.setTimeout(() => {
      clearLaunchProgress();
      navigate("markets");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [launchProgress?.phase, navigate, clearLaunchProgress]);

  const phase = launchProgress?.phase;
  const step = phase === "success" ? 4 : phase === "indexing" ? 3 : phase === "confirming" ? 2 : phase === "preparing" ? 0 : 1;

  return (
    <main className="launch-page">
      <section className="wrap launch-layout">
        <div className="launch-copy">
          <div className="eyebrow light">
            <span /> Create
          </div>
          <h1>Launch a token.</h1>
          <p>{publicOpen === true ? "Anyone can create a market. Your wallet pays the network fee." : "Set up your token below. You’ll review the transaction in your wallet before it goes live."}</p>
        </div>
        <form className="launch-form" onSubmit={create}>
          <div className="launch-form-section">
            <div className="form-heading">
              <span>01 / Token details</span>
              <strong>Make it yours.</strong>
              <p>Choose the name and ticker people will see in Markets.</p>
            </div>
            <label>
              <span>Token name <b>Required</b></span>
              <input
                name="name"
                required
                placeholder="e.g. Curveball"
                autoComplete="off"
                maxLength={64}
              />
              <small>The name people will see across Curveball.</small>
            </label>
            <label>
              <span>Symbol <b>Required</b></span>
              <span className="symbol-input">
                <i>$</i>
                <input name="symbol" required placeholder="CURVE" autoComplete="off" maxLength={12} />
              </span>
              <small>A short ticker displayed with a $ sign.</small>
            </label>
            <label>
              <span>Metadata URL <b>Optional</b></span>
              <input name="uri" type="text" inputMode="url" placeholder="https://example.com/token.json" autoComplete="url" />
              <small>An HTTPS or IPFS URL for extra token metadata. You can leave this blank.</small>
            </label>
          </div>
          {activeContractVersion === "v2" && <div className="launch-form-section launch-settings">
            <div className="form-heading">
              <span>02 / Launch settings</span>
              <strong>Set your launch.</strong>
              <p>Both choices are optional. You can launch without making a first buy.</p>
            </div>
            <label>
              <span>Creator tax <b>Optional</b></span>
              <select name="creatorTaxBps" defaultValue="0">
                <option value="0">None</option>
                <option value="10">0.1%</option>
                <option value="25">0.25%</option>
                <option value="50">0.5% maximum</option>
              </select>
              <small>Your share of quote trades, up to 0.5%.</small>
            </label>
            <label>
              <span>Initial buy <b>Optional</b></span>
              <input name="initialBuy" type="number" min="0" step="any" inputMode="decimal" placeholder="0" />
              <small>WETH budget including fees. This may need a separate wrap and approval in your wallet.</small>
            </label>
          </div>}
          {address && !canCreate && <p className="notice" role="status">{publicOpen === false && invited === false ? "This deployed factory is still invite-only. Use a public factory to launch without an invitation." : "Checking launch access for this factory…"}</p>}
          <button
            className="launch-button"
            type="submit"
            disabled={!address || isPending || !canCreate}
          >
            {isPending ? "Launching token…" : "Review and create token"} <ArrowIcon />
          </button>
          <p className="form-note">
            {publicOpen === true
              ? "Creation is open to every connected wallet. No invitation needed."
              : !launchpadAddress ? "Configure a factory to launch."
                : address && invited === true ? "Your wallet has access to this factory."
                  : address && publicOpen === false && invited === false ? "This factory currently requires an invitation."
                    : address ? "Checking this factory’s launch access…" : "Connect from the navigation to check launch access."}
          </p>
        </form>
      </section>
      {launchProgress && <div className="launch-modal-backdrop">
        <section className="launch-modal" role="dialog" aria-modal="true" aria-labelledby="launch-modal-title" aria-describedby="launch-modal-detail">
          <div className="launch-modal-top">
            <span className="eyebrow">Launch progress</span>
            {(phase === "error" || phase === "success") && <button type="button" className="launch-modal-close" aria-label="Close launch progress" onClick={() => { clearLaunchProgress(); if (phase === "success") navigate("markets"); }}>×</button>}
          </div>
          <div className={`launch-progress-mark ${phase === "error" ? "failed" : phase === "success" ? "complete" : ""}`} aria-hidden="true">{phase === "error" ? "!" : phase === "success" ? "✓" : "↗"}</div>
          <h2 id="launch-modal-title" ref={dialogHeading} tabIndex={-1}>{phase === "error" ? "Launch stopped" : phaseCopy[phase!]?.title}</h2>
          <p id="launch-modal-detail">{phase === "error" ? launchProgress.error : phaseCopy[phase!]?.detail}</p>
          <ol className="launch-steps">
            {["Prepare", "Confirm in wallet", "Confirm on chain", "Show in Markets"].map((label, index) => <li key={label} className={phase === "error" ? "" : index < step ? "done" : index === step ? "current" : ""}><span>{index < step && phase !== "error" ? "✓" : index + 1}</span>{label}</li>)}
          </ol>
          {launchProgress.hash && <a className="launch-tx-link" href={`${activeExplorerUrl}/tx/${launchProgress.hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
          {phase === "error" && <button type="button" className="launch-modal-action" onClick={clearLaunchProgress}>Check details and try again</button>}
          {phase === "success" && <button type="button" className="launch-modal-action" onClick={() => { clearLaunchProgress(); navigate("markets"); }}>View your token in Markets <ArrowIcon /></button>}
        </section>
      </div>}
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useSwitchChain } from "wagmi";
import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { formatEther, formatUnits, getAddress, parseEther, zeroAddress, type Address, type Hash } from "viem";
import { ADMIN_ADDRESS, SUPER_ADMIN_ADDRESS, feePercentToBps, nominateFeeController, readFactoryFunds, readFeeDefaults, submitFeeUpdate, type FactoryFunds, type FeeAuthority } from "../lib/adminFees";
import { readableError } from "../lib/errors";
import { formatAddress } from "../lib/format.js";
import { activeChainId, activeExplorerUrl, activeFactoryVersion, launchpadAddress, wagmiConfig } from "../lib/web3";
import { v2FactoryAbi } from "../sdk/v2Contracts";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";

type Settings = FeeAuthority;

function displayBalance(balance: bigint, decimals: number): string {
  const [whole, fraction = ""] = formatUnits(balance, decimals).split(".");
  const visibleFraction = fraction.slice(0, 6).replace(/0+$/, "");
  if (balance > 0n && whole === "0" && !visibleFraction) return "<0.000001";
  return visibleFraction ? `${whole}.${visibleFraction}` : whole;
}

function ExplorerAddress({ address, label }: { address: Address; label: string }) {
  return <a href={`${activeExplorerUrl}/address/${address}`} target="_blank" rel="noreferrer" title={address} aria-label={`${label}: ${address}. View on explorer`}>{formatAddress(address)} <span aria-hidden="true">↗</span></a>;
}

function FundsPanel({ funds }: { funds: FactoryFunds }) {
  return <section className="admin-panel admin-funds-summary" aria-labelledby="admin-funds-title">
    <div className="admin-side-head"><h2 id="admin-funds-title">Protocol funds</h2><span>{funds.symbol}</span></div>
    <dl className="admin-funds-grid">
      {[
        { label: "Trading treasury", fund: funds.tradingTreasury },
        { label: "Launch treasury", fund: funds.launchTreasury },
        { label: "Buyback vault", fund: funds.buybackVault },
      ].filter(({ fund }) => fund.address !== zeroAddress).map(({ label, fund }) => <div key={label} className="admin-fund-row">
        <dt>{label}</dt>
        <dd><strong>{displayBalance(fund.balance, funds.decimals)} <span>{funds.symbol}</span></strong><ExplorerAddress address={fund.address} label={label} /></dd>
      </div>)}
    </dl>
  </section>;
}

function FactoryDetails({ settings, factory }: { settings: Settings; factory: Address }) {
  return <aside className="admin-panel admin-details" aria-labelledby="admin-details-title">
    <h2 id="admin-details-title">Factory details</h2>
    <dl>
      <div><dt>Factory</dt><dd><ExplorerAddress address={factory} label="Factory" /></dd></div>
      <div><dt>Owner</dt><dd><ExplorerAddress address={settings.owner} label="Owner" /></dd></div>
      {settings.pendingOwner !== zeroAddress && <div><dt>Pending owner</dt><dd><ExplorerAddress address={settings.pendingOwner} label="Pending owner" /></dd></div>}
      {settings.controller && <><div><dt>Super admin</dt><dd><ExplorerAddress address={settings.controller.superAdmin} label="Super admin" /></dd></div><div><dt>Fee admin</dt><dd><ExplorerAddress address={settings.controller.feeAdmin} label="Fee admin" /></dd></div></>}
      <div><dt>Creator share</dt><dd>{(settings.creatorShareBps / 100).toFixed(2)}%</dd></div>
      <div><dt>Buyback share</dt><dd>{(settings.buybackShareBps / 100).toFixed(2)}%</dd></div>
      <div><dt>Creator tax cap</dt><dd>{(settings.creatorTaxCapBps / 100).toFixed(2)}%</dd></div>
      <div><dt>Treasury</dt><dd><ExplorerAddress address={settings.treasury} label="Treasury" /></dd></div>
    </dl>
  </aside>;
}

export function AdminPage() {
  const feeInputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const focusInputAfterSave = useRef(false);
  const { address, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [funds, setFunds] = useState<FactoryFunds | null>(null);
  const [draft, setDraft] = useState("");
  const [reviewBps, setReviewBps] = useState<number | null>(null);
  const [controllerDraft, setControllerDraft] = useState("");
  const [controllerReview, setControllerReview] = useState<Address | null>(null);
  const [controllerError, setControllerError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hash | null>(null);
  const [target, setTarget] = useState<bigint | null>(null);
  const [targetDraft, setTargetDraft] = useState("");
  const [targetReview, setTargetReview] = useState<bigint | null>(null);
  const [targetError, setTargetError] = useState("");
  const configured = activeChainId === RISE_TESTNET_CHAIN_ID && Boolean(launchpadAddress);
  const isAdmin = address?.toLowerCase() === settings?.owner.toLowerCase()
    || address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase()
    || address?.toLowerCase() === SUPER_ADMIN_ADDRESS.toLowerCase();
  const correctChain = chainId === activeChainId;

  const refresh = useCallback(async (resetDraft = false) => {
    if (!configured || !launchpadAddress) { setLoading(false); return; }
    setLoading(true);
    try {
      const [latest, latestFunds] = await Promise.all([
        readFeeDefaults(wagmiConfig, launchpadAddress, activeChainId),
        readFactoryFunds(wagmiConfig, launchpadAddress, activeChainId),
      ]);
      setSettings(latest);
      setFunds(latestFunds);
      if (resetDraft) setDraft((latest.feeBps / 100).toFixed(2));
      if (activeFactoryVersion === "V1") {
        const nextTarget = await readContract(wagmiConfig, { address: launchpadAddress, abi: v2FactoryAbi, functionName: "graduationTarget", chainId: activeChainId });
        setTarget(nextTarget);
        if (resetDraft) setTargetDraft(formatEther(nextTarget));
      }
      setError("");
    } catch (cause) {
      setError(readableError(cause, "Could not read factory settings or balances."));
    } finally { setLoading(false); }
  }, [configured]);

  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => { if (reviewBps !== null) confirmRef.current?.focus(); }, [reviewBps]);
  useEffect(() => {
    if (!pending && focusInputAfterSave.current) {
      focusInputAfterSave.current = false;
      feeInputRef.current?.focus();
    }
  }, [pending]);

  const onReview = (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    try {
      const next = feePercentToBps(draft, settings.creatorTaxCapBps);
      if (next === settings.feeBps) throw new Error("The fee is already set to this value.");
      setReviewBps(next);
      setError("");
      setFieldError("");
      setMessage("");
    } catch (cause) { setFieldError(readableError(cause)); }
  };

  const run = async () => {
    if (!launchpadAddress || pending) return;
    setPending(true);
    setHash(null);
    setError("");
    setMessage("Confirm the fee update in your wallet.");
    try {
      const tx = await submitFeeUpdate(wagmiConfig, launchpadAddress, activeChainId, reviewBps!, setHash);
      setHash(tx);
      setReviewBps(null);
      await refresh(true);
      setMessage("Fee update confirmed on-chain.");
      focusInputAfterSave.current = true;
    } catch (cause) {
      setError(readableError(cause, "Transaction failed."));
      setMessage("");
    } finally { setPending(false); }
  };

  const runController = async () => {
    if (!launchpadAddress || !controllerReview || pending) return;
    setPending(true);
    setHash(null);
    setError("");
    setMessage("Confirm the controller nomination in your wallet.");
    try {
      const tx = await nominateFeeController(wagmiConfig, launchpadAddress, activeChainId, controllerReview, setHash);
      setHash(tx);
      setControllerReview(null);
      await refresh(false);
      setMessage("Controller nominated on-chain. Dot must accept factory ownership through the controller.");
    } catch (cause) {
      setError(readableError(cause, "Controller nomination failed."));
      setMessage("");
    } finally { setPending(false); }
  };

  const runTarget = async () => {
    if (!launchpadAddress || !address || targetReview === null || pending) return;
    setPending(true);
    setHash(null);
    setError("");
    setMessage("Confirm the graduation target update in your wallet.");
    try {
      const simulation = await simulateContract(wagmiConfig, {
        address: launchpadAddress, abi: v2FactoryAbi, functionName: "setGraduationTarget",
        args: [targetReview], account: address, chainId: activeChainId,
      });
      const tx = await writeContract(wagmiConfig, simulation.request);
      setHash(tx);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: tx, chainId: activeChainId });
      if (receipt.status !== "success") throw new Error("Graduation target transaction reverted.");
      setTarget(targetReview);
      setTargetDraft(formatEther(targetReview));
      setTargetReview(null);
      setMessage("Graduation target updated for future launches.");
    } catch (cause) {
      setError(readableError(cause, "Graduation target update failed."));
      setMessage("");
    } finally { setPending(false); }
  };

  return <main className="page-main admin-page wrap">
    <h1 className="visually-hidden">Admin controls</h1>
    {!address ? <section className="admin-panel admin-state"><h2>Connect your wallet</h2><p>Connect the admin wallet to manage the factory fee.</p><button type="button" className="primary-button" onClick={() => openConnectModal?.()}>Connect wallet</button></section>
      : !isAdmin ? <section className="admin-panel admin-state"><h2>Access restricted</h2><p>This dashboard is available to the designated fee admin or dot wallet.</p></section>
      : !configured ? <section className="admin-panel admin-state"><h2>Factory unavailable</h2><p>Configure the active factory before managing settings.</p></section>
      : <>
        {!correctChain && <div className="notice admin-notice" role="status">Switch to the configured network to submit transactions. <button type="button" onClick={() => switchChain({ chainId: activeChainId })}>Switch network</button></div>}
        {error && <p className="notice admin-notice" role="alert">{error}</p>}
        {(message || hash) && <p className="admin-feedback" role="status">{message || "Check the submitted transaction before retrying."} {hash && <a href={`${activeExplorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</p>}
        {loading && !settings ? <section className="admin-panel admin-state" aria-busy="true">Reading factory settings…</section>
          : settings && <>
          <div className="admin-grid">
            {activeFactoryVersion === "V1" && target !== null && settings.owner.toLowerCase() === address.toLowerCase() && <section className="admin-panel admin-fee-panel" aria-labelledby="admin-target-title">
              <div className="admin-panel-head"><h2 id="admin-target-title">Graduation target</h2><div className="admin-current-fee"><span>Current target</span><strong>{formatEther(target)} WETH</strong></div></div>
              <p className="admin-description">Collected WETH sent to the pool when the curve sells out. Changes apply to future launches only.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                try {
                  const next = parseEther(targetDraft.trim());
                  if (next <= 0n || next === target) throw new Error("Enter a new positive WETH amount.");
                  setTargetReview(next);
                  setTargetError("");
                } catch (cause) { setTargetError(readableError(cause)); }
              }}>
                <label className="admin-label" htmlFor="admin-target">New graduation target in WETH</label>
                <div className="admin-fee-input"><input id="admin-target" type="text" inputMode="decimal" value={targetDraft} disabled={pending || !correctChain} aria-invalid={Boolean(targetError)} aria-describedby={targetError ? "admin-target-error" : undefined} onChange={(event) => { setTargetDraft(event.target.value); setTargetReview(null); setTargetError(""); }} /><span>WETH</span></div>
                {targetError && <p id="admin-target-error" className="notice" role="alert">{targetError}</p>}
                {targetReview === null ? <button type="submit" className="primary-button" disabled={pending || !correctChain}>Review target</button>
                  : <div className="admin-review"><p>Set the target for future launches to <strong>{formatEther(targetReview)} WETH</strong>?</p><div className="admin-actions"><button type="button" className="primary-button" disabled={pending || !correctChain} onClick={() => void runTarget()}>{pending ? "Waiting for confirmation…" : "Confirm in wallet"}</button><button type="button" className="admin-secondary" disabled={pending} onClick={() => setTargetReview(null)}>Cancel</button></div></div>}
              </form>
            </section>}
            <section className="admin-panel admin-fee-panel" aria-labelledby="admin-fee-title">
              <div className="admin-panel-head"><h2 id="admin-fee-title">Curve trading fee</h2><div className="admin-fee-metrics"><div className="admin-current-fee"><span>Current fee</span><strong>{(settings.feeBps / 100).toFixed(2)}%</strong></div><button type="button" className="market-refresh admin-refresh" disabled={pending || loading} aria-label={loading ? "Refreshing chain data" : "Refresh chain data"} aria-busy={loading} title={loading ? "Refreshing chain data" : "Refresh chain data"} onClick={() => void refresh(false)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 8A7 7 0 1 0 17 11" /><path d="M17 3.5V8h-4.5" /></svg></button></div></div>
              <p className="admin-description">Future launches only. Existing market fees stay fixed.</p>
              {(settings.owner.toLowerCase() === address.toLowerCase() || (settings.controller?.feeAdmin.toLowerCase() === address.toLowerCase() && settings.controller.superAdmin === SUPER_ADMIN_ADDRESS)) ? <form onSubmit={onReview}>
                <label className="admin-label" htmlFor="admin-fee">New trading fee</label>
                <div className="admin-fee-input"><input ref={feeInputRef} id="admin-fee" type="text" inputMode="decimal" value={draft} disabled={pending || !correctChain} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? "admin-fee-help admin-fee-error" : "admin-fee-help"} onChange={(event) => { setDraft(event.target.value); setReviewBps(null); setFieldError(""); }} /><span>%</span></div>
                <p id="admin-fee-help" className="admin-help">0.00%–5.00% · 0.01% steps</p>
                {fieldError && <p id="admin-fee-error" className="notice" role="alert">{fieldError}</p>}
                {reviewBps === null ? <button type="submit" className="primary-button" disabled={pending || !correctChain || loading}>Review change</button>
                  : <div className="admin-review" role="group" aria-label="Review fee update"><p>Change future launch fees from <strong>{(settings.feeBps / 100).toFixed(2)}%</strong> to <strong>{(reviewBps / 100).toFixed(2)}%</strong>?</p><div className="admin-actions"><button ref={confirmRef} type="button" className="primary-button" disabled={pending || !correctChain} onClick={() => void run()}>{pending ? "Waiting for confirmation…" : "Confirm in wallet"}</button><button type="button" className="admin-secondary" disabled={pending} onClick={() => { setReviewBps(null); feeInputRef.current?.focus(); }}>Cancel</button></div></div>}
              </form> : <p className="admin-help">Fee editing unavailable for this wallet.</p>}
              {activeFactoryVersion !== "V1" && settings.owner.toLowerCase() === address.toLowerCase() && (settings.pendingOwner === zeroAddress ? <form className="admin-controller-form" onSubmit={(event) => {
                event.preventDefault();
                try { setControllerReview(getAddress(controllerDraft.trim())); setControllerError(""); }
                catch { setControllerError("Enter a valid controller contract address."); }
              }}>
                <h3>Keep dot as super admin</h3>
                <label className="admin-label" htmlFor="admin-controller-address">Controller address</label>
                <input id="admin-controller-address" className="admin-controller-input" type="text" value={controllerDraft} disabled={pending || !correctChain} aria-invalid={Boolean(controllerError)} aria-describedby={controllerError ? "admin-controller-error" : undefined} onChange={(event) => { setControllerDraft(event.target.value); setControllerReview(null); setControllerError(""); }} />
                {controllerError && <p id="admin-controller-error" className="notice" role="alert">{controllerError}</p>}
                {controllerReview ? <div className="admin-review"><p>Nominate <code>{controllerReview}</code> as factory owner? Dot must accept to complete the handoff.</p><div className="admin-actions"><button type="button" className="primary-button" disabled={pending || !correctChain} onClick={() => void runController()}>{pending ? "Waiting for confirmation…" : "Confirm in wallet"}</button><button type="button" className="admin-secondary" disabled={pending} onClick={() => setControllerReview(null)}>Cancel</button></div></div>
                  : <button type="submit" className="admin-secondary" disabled={pending || !correctChain}>Review controller handoff</button>}
              </form> : <p className="admin-help">Pending owner: <ExplorerAddress address={settings.pendingOwner} label="Pending owner" /> · Awaiting acceptance</p>)}
            </section>
            <div className="admin-side">
              {funds && <FundsPanel funds={funds} />}
              <FactoryDetails settings={settings} factory={launchpadAddress!} />
            </div>
          </div></>}
      </>}
  </main>;
}

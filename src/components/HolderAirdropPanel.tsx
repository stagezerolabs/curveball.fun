import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { formatEther, parseEther, zeroAddress, type Address } from "viem";
import { holderReserveAbi, factoryAbi } from "../sdk/contracts";
import { activeChainId, activeExplorerUrl, wagmiConfig } from "../lib/web3";
import { readHolderSnapshot } from "../lib/holderSnapshot";
import type { Token } from "../types";

type ReserveState = {
  address: Address;
  total: bigint;
  committed: bigint;
  graduationBlock: bigint;
  excluded: Address[];
  roundCount: bigint;
  latestBlock: bigint;
  rounds: Array<{ id: bigint; snapshot: bigint; amount: bigint; claimable: bigint }>;
};

function displayAmount(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function HolderAirdropPanel({ token }: { token: Token }) {
  const client = usePublicClient({ chainId: activeChainId });
  const { address: wallet, chainId } = useAccount();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [snapshotEdited, setSnapshotEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(10);
  const [shownHolders, setShownHolders] = useState(10);

  const reserveQuery = useQuery<ReserveState | null>({
    queryKey: ["holder-airdrop-reserve", activeChainId, token.address, token.factory, wallet, visible],
    enabled: Boolean(client && token.factory),
    queryFn: async () => {
      if (!client || !token.factory) throw new Error("No chain client available.");
      const reserve = await client.readContract({ address: token.factory, abi: factoryAbi, functionName: "holderReserve" });
      if (reserve === zeroAddress) throw new Error("Holder reserve is not configured.");
      const [launch, latestBlock] = await Promise.all([
        client.readContract({ address: reserve, abi: holderReserveAbi, functionName: "launches", args: [token.address] }),
        client.getBlockNumber(),
      ]);
      const count = launch[7];
      const start = count > BigInt(visible) ? count - BigInt(visible) : 0n;
      const ids = Array.from({ length: Number(count - start) }, (_, index) => count - 1n - BigInt(index));
      const rounds = await Promise.all(ids.map(async (id) => {
        const [round, claimable] = await Promise.all([
          client.readContract({ address: reserve, abi: holderReserveAbi, functionName: "rounds", args: [token.address, id] }),
          wallet ? client.readContract({ address: reserve, abi: holderReserveAbi, functionName: "claimable", args: [token.address, id, wallet] }) : Promise.resolve(0n),
        ]);
        return { id, snapshot: round[0], amount: round[1], claimable };
      }));
      return { address: reserve, total: launch[4], committed: launch[5], graduationBlock: launch[6], excluded: [reserve, launch[1], launch[2], launch[3]], roundCount: count, latestBlock, rounds };
    },
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const state = reserveQuery.data ?? null;

  useEffect(() => { setVisible(10); setSnapshot(""); setSnapshotEdited(false); setShownHolders(10); }, [token.address]);
  useEffect(() => {
    if (state && !snapshotEdited) setSnapshot(state.latestBlock > 0n ? String(state.latestBlock - 1n) : "");
  }, [state?.latestBlock, snapshotEdited]);

  const snapshotBlock = state && state.graduationBlock > 0n
    ? (() => {
      try {
        const requested = BigInt(snapshot);
        return requested >= state.graduationBlock && requested < state.latestBlock ? requested : state.latestBlock - 1n;
      } catch { return state.latestBlock - 1n; }
    })()
    : null;
  useEffect(() => { setShownHolders(10); }, [snapshotBlock]);

  const holdersQuery = useQuery({
    queryKey: ["holder-airdrop-holders", activeChainId, token.address, token.createdBlock, snapshotBlock?.toString(), state?.excluded],
    enabled: Boolean(client && state && snapshotBlock !== null && token.createdBlock),
    queryFn: async () => {
      if (!client || !state || snapshotBlock === null || !token.createdBlock) throw new Error("Holder snapshot is unavailable.");
      return readHolderSnapshot(client, token.address, BigInt(token.createdBlock), snapshotBlock, state.excluded);
    },
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const holders = holdersQuery.data ?? [];
  const holdersLoading = holdersQuery.isPending;
  const holdersError = !holdersQuery.data && holdersQuery.error ? holdersQuery.error.message : "";

  async function refresh() {
    await reserveQuery.refetch();
    if (state && snapshotBlock !== null) await holdersQuery.refetch();
  }

  if (!state) return <section className="holder-airdrop" aria-label="Holder airdrops" aria-busy={reserveQuery.isPending}>
    {reserveQuery.isPending && token.factory ? <p role="status">Loading holder airdrops…</p> : reserveQuery.error ? <><p role="alert">Could not load holder airdrops: {reserveQuery.error.message}</p><button type="button" className="holder-airdrop-text-button" onClick={() => void reserveQuery.refetch()}>Retry</button></> : <p>Holder airdrops are unavailable for this launch.</p>}
  </section>;
  const isCreator = wallet?.toLowerCase() === token.creator.toLowerCase();
  const available = state.total - state.committed;
  const eligibleBalance = holders.reduce((sum, holder) => sum + holder.balance, 0n);
  let previewAmount = 0n;
  try { previewAmount = amount ? parseEther(amount) : 0n; } catch { /* Keep the preview empty while editing. */ }
  if (previewAmount < 0n || previewAmount > available) previewAmount = 0n;

  async function submit(functionName: "createRound" | "claim", args: readonly [Address, bigint, bigint] | readonly [Address, bigint, Address]) {
    if (!state || !wallet) return;
    setBusy(true);
    setError("");
    setStatus("Confirm the transaction in your wallet.");
    try {
      if (chainId !== activeChainId) await switchChain(wagmiConfig, { chainId: activeChainId });
      const hash = functionName === "createRound"
        ? await writeContract(wagmiConfig, { address: state.address, abi: holderReserveAbi, functionName, args: args as readonly [Address, bigint, bigint], chainId: activeChainId })
        : await writeContract(wagmiConfig, { address: state.address, abi: holderReserveAbi, functionName, args: args as readonly [Address, bigint, Address], chainId: activeChainId });
      setStatus("Waiting for confirmation…");
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: activeChainId });
      if (receipt.status !== "success") throw new Error("Transaction reverted.");
      setStatus(functionName === "claim" ? "Airdrop claimed." : "Airdrop round started.");
      setAmount("");
      await refresh();
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Transaction failed.");
    } finally { setBusy(false); }
  }

  function startRound(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state) return;
    try {
      const tokens = parseEther(amount);
      const block = BigInt(snapshot);
      if (tokens <= 0n || tokens > available || block < state.graduationBlock || block >= state.latestBlock) throw new Error("Check the amount and snapshot block.");
      void submit("createRound", [token.address, block, tokens]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the amount and snapshot block."); }
  }

  const refreshing = reserveQuery.isFetching || holdersQuery.isFetching;

  return <section className="holder-airdrop" aria-labelledby="holder-airdrop-title">
    <div className="holder-airdrop-heading"><div><h2 id="holder-airdrop-title">Holder airdrops</h2></div><button type="button" className="market-refresh" onClick={() => void refresh()} disabled={busy || refreshing} aria-label="Refresh airdrop data" aria-busy={refreshing} title="Refresh airdrop data"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 8A7 7 0 1 0 17 11" /><path d="M17 3.5V8h-4.5" /></svg></button></div>
    <dl className="holder-airdrop-summary">
      <div className="holder-airdrop-summary-primary"><dt>Available to distribute</dt><dd>{displayAmount(available)} <small>{token.symbol}</small></dd></div>
      <div><dt>Allocated to rounds</dt><dd>{displayAmount(state.committed)} <small>{token.symbol}</small></dd></div>
      <div><dt>Total reserved</dt><dd>{displayAmount(state.total)} <small>{token.symbol}</small></dd></div>
    </dl>
    <div className={`holder-airdrop-body${isCreator ? "" : " holder-airdrop-body-wide"}`}>
      <div className="holder-airdrop-holders">
        <div className="holder-airdrop-section-heading"><div><h3>Eligible holders <span>{!holdersLoading && !holdersError ? holders.length : ""}</span></h3><p>{snapshotBlock !== null ? `Balances at block ${String(snapshotBlock)}` : "Available after graduation"}</p></div></div>
        {state.graduationBlock === 0n ? <div className="holder-airdrop-empty">Holder snapshots become available after graduation.</div>
          : holdersLoading ? <div className="holder-airdrop-empty" role="status">Loading holders…</div>
          : holdersError ? <div className="holder-airdrop-empty" role="alert">Could not load holders. <button type="button" className="holder-airdrop-text-button" onClick={() => void holdersQuery.refetch()}>Retry</button></div>
          : holders.length === 0 ? <div className="holder-airdrop-empty">No eligible holders at this snapshot.</div>
          : <><div className="holder-airdrop-table-wrap"><table className="holder-airdrop-table"><thead><tr><th scope="col">Holder</th><th scope="col">Balance</th><th scope="col">Share</th><th scope="col">Est. allocation</th></tr></thead><tbody>{holders.slice(0, shownHolders).map((holder, index) => <tr key={holder.address}><td><span className="holder-airdrop-rank">{String(index + 1).padStart(2, "0")}</span><a href={`${activeExplorerUrl}/address/${holder.address}`} target="_blank" rel="noreferrer" title={holder.address}>{shortAddress(holder.address)} <span aria-hidden="true">↗</span></a></td><td>{displayAmount(holder.balance)} <small>{token.symbol}</small></td><td>{eligibleBalance > 0n ? `${(Number(holder.balance * 10_000n / eligibleBalance) / 100).toFixed(2)}%` : "0%"}</td><td className="holder-airdrop-allocation">{previewAmount > 0n && eligibleBalance > 0n ? `${displayAmount(previewAmount * holder.balance / eligibleBalance)} ${token.symbol}` : "—"}</td></tr>)}</tbody></table></div>
            {shownHolders < holders.length && <button type="button" className="holder-airdrop-text-button holder-airdrop-more" onClick={() => setShownHolders((value) => value + 10)}>Show more holders</button>}</>}
        <div className="holder-airdrop-rounds"><div className="holder-airdrop-rounds-heading"><h3>Rounds</h3><span>{String(state.roundCount)}</span></div>
          {state.roundCount === 0n ? <p>No rounds yet.</p> : <ol>{state.rounds.map((round) => <li key={String(round.id)}>
            <div><strong>Round {String(round.id + 1n)}</strong><span>{formatEther(round.amount)} {token.symbol} · block {String(round.snapshot)}</span></div>
            {wallet && <div><span>Your claim: {formatEther(round.claimable)} {token.symbol}</span>{round.claimable > 0n && <button type="button" disabled={busy} onClick={() => void submit("claim", [token.address, round.id, wallet])}>Claim</button>}</div>}
          </li>)}</ol>}
          {BigInt(visible) < state.roundCount && <button type="button" className="holder-airdrop-text-button" onClick={() => setVisible((count) => count + 10)}>Show older rounds</button>}
        </div>
      </div>
      {isCreator && <div className="holder-airdrop-actions">
        {isCreator && state.graduationBlock > 0n && available > 0n && <form className="holder-airdrop-form" onSubmit={startRound}>
          <div><h3>Start a round</h3><p>Set an amount to preview each holder’s share.</p></div>
          <label>Tokens to distribute<input type="number" min="0" max={formatEther(available)} step="any" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
          <label>Snapshot block<input type="number" min={String(state.graduationBlock)} max={String(state.latestBlock - 1n)} step="1" required value={snapshot} onChange={(event) => { setSnapshotEdited(true); setSnapshot(event.target.value); }} /></label>
          <button className="primary-button" type="submit" disabled={busy}>Start round</button>
        </form>}
        {isCreator && state.graduationBlock === 0n && <p className="launch-field-help">Airdrop rounds unlock after graduation.</p>}
        {state.graduationBlock > 0n && available === 0n && <p className="launch-field-help">All reserved tokens are allocated.</p>}
      </div>}
    </div>
    {status && <p role="status">{status}</p>}
    {error && <p className="notice" role="alert">{error}</p>}
  </section>;
}

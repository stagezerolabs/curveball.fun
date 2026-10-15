import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { formatEther, parseEther, zeroAddress, type Address } from "viem";
import { holderReserveAbi, v2FactoryAbi } from "../sdk/v2Contracts";
import { activeChainId, wagmiConfig } from "../lib/web3";
import type { Token } from "../types";

type ReserveState = {
  address: Address;
  total: bigint;
  committed: bigint;
  graduationBlock: bigint;
  roundCount: bigint;
  latestBlock: bigint;
  rounds: Array<{ id: bigint; snapshot: bigint; amount: bigint; claimable: bigint }>;
};

export function HolderAirdropPanel({ token }: { token: Token }) {
  const client = usePublicClient({ chainId: activeChainId });
  const { address: wallet, chainId } = useAccount();
  const [state, setState] = useState<ReserveState | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(10);
  const [supportsReserve, setSupportsReserve] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !token.factory) return;
    try {
      const reserve = await client.readContract({ address: token.factory, abi: v2FactoryAbi, functionName: "holderReserve" });
      if (reserve === zeroAddress) return;
      setSupportsReserve(true);
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
      setState({ address: reserve, total: launch[4], committed: launch[5], graduationBlock: launch[6], roundCount: count, latestBlock, rounds });
      setSnapshot((current) => current || (latestBlock > 0n ? String(latestBlock - 1n) : ""));
      setError("");
    } catch (cause) {
      // Older factories have no reserve method. They simply have no airdrop panel.
      setError(cause instanceof Error ? cause.message : "Could not load airdrops.");
    }
  }, [client, token.address, token.factory, visible, wallet]);

  useEffect(() => { setState(null); setSupportsReserve(false); setVisible(10); }, [token.address]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!state) return supportsReserve ? <section className="holder-airdrop" aria-label="Holder airdrops" aria-busy={!error}>
    {error ? <><p role="alert">Could not load holder airdrops: {error}</p><button type="button" className="market-refresh" onClick={() => void refresh()}>Retry</button></> : <p>Loading holder airdrops…</p>}
  </section> : null;
  const isCreator = wallet?.toLowerCase() === token.creator.toLowerCase();
  const available = state.total - state.committed;

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

  return <section className="holder-airdrop" aria-labelledby="holder-airdrop-title">
    <div className="holder-airdrop-heading"><h2 id="holder-airdrop-title">Holder airdrops</h2><span>{formatEther(state.total)} {token.symbol} reserved</span><button type="button" className="market-refresh" onClick={() => void refresh()} disabled={busy}>Refresh</button></div>
    <p>Creators can allocate the reserve across rounds after graduation. Each round uses direct token balances at its published snapshot block. Pool and Curveball custody balances are excluded.</p>
    <dl className="holder-airdrop-summary"><div><dt>Available for new rounds</dt><dd>{formatEther(available)} {token.symbol}</dd></div><div><dt>Allocated</dt><dd>{formatEther(state.committed)} {token.symbol}</dd></div></dl>
    {isCreator && state.graduationBlock > 0n && available > 0n && <form className="holder-airdrop-form" onSubmit={startRound}>
      <h3>Start an airdrop round</h3>
      <label>Tokens to distribute<input type="number" min="0" step="any" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Snapshot block<input type="number" min={String(state.graduationBlock)} max={String(state.latestBlock - 1n)} step="1" required value={snapshot} onChange={(event) => setSnapshot(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={busy}>Start round</button>
    </form>}
    {isCreator && state.graduationBlock === 0n && <p className="launch-field-help">Airdrop rounds unlock after graduation.</p>}
    <div className="holder-airdrop-rounds"><h3>Rounds</h3>
      {state.roundCount === 0n ? <p>No rounds yet.</p> : <ol>{state.rounds.map((round) => <li key={String(round.id)}>
        <div><strong>Round {String(round.id + 1n)}</strong><span>{formatEther(round.amount)} {token.symbol} · block {String(round.snapshot)}</span></div>
        {wallet && <div><span>Your claim: {formatEther(round.claimable)} {token.symbol}</span>{round.claimable > 0n && <button type="button" disabled={busy} onClick={() => void submit("claim", [token.address, round.id, wallet])}>Claim</button>}</div>}
      </li>)}</ol>}
      {BigInt(visible) < state.roundCount && <button type="button" className="market-refresh" onClick={() => setVisible((count) => count + 10)}>Show older rounds</button>}
    </div>
    {status && <p role="status">{status}</p>}
    {error && <p className="notice" role="alert">{error}</p>}
  </section>;
}

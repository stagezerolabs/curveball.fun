import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { readHolderSnapshot } from "../lib/holderSnapshot";
import { parseCreatedBlock } from "../lib/marketChart";
import { activeChainId, activeDeploymentBlock, activeExplorerUrl } from "../lib/web3";
import type { Token } from "../types";

function amount(value: bigint) {
  return Number(formatEther(value)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function CreatorTokenInsights({ token }: { token: Token }) {
  const client = usePublicClient({ chainId: activeChainId });
  const [showAllHolders, setShowAllHolders] = useState(false);
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["creator-holders", activeChainId, token.address, token.createdBlock, token.curve, token.pool, token.factory],
    enabled: Boolean(client),
    queryFn: async () => {
      if (!client) throw new Error("No chain client available.");
      const latestBlock = await client.getBlockNumber();
      const block = latestBlock > 0n ? latestBlock - 1n : latestBlock;
      const excluded = [token.curve, token.pool, token.factory].filter((value): value is Address => Boolean(value));
      const holders = await readHolderSnapshot(client, token.address, parseCreatedBlock(token.createdBlock, activeDeploymentBlock), block, excluded);
      return { holders, block };
    },
    staleTime: 120_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const holders = data?.holders ?? [];
  const snapshotBlock = data?.block ?? null;
  const holdersLoading = isPending;
  const holdersError = !data && error ? error.message : "";
  const directBalance = holders.reduce((sum, holder) => sum + holder.balance, 0n);
  const visibleHolders = showAllHolders ? holders : holders.slice(0, 10);
  return <div className="creator-insights">
    <div className="creator-insights-heading"><div><h2>Holder overview</h2><p>Direct wallet balances for ${token.symbol}.</p></div><button type="button" className="market-refresh" onClick={() => void refetch()} disabled={isFetching} aria-label={isFetching ? "Refreshing holders" : "Refresh holders"} aria-busy={isFetching} title="Refresh holders"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 8A7 7 0 1 0 17 11" /><path d="M17 3.5V8h-4.5" /></svg></button></div>
    <section id="profile-holders" className="creator-data-panel" aria-labelledby="creator-holders-title" aria-busy={holdersLoading}>
      <div className="creator-data-heading"><div><h3 id="creator-holders-title">Top holders</h3><p>{snapshotBlock === null ? "Loading wallet balances…" : `Wallet balances at block ${snapshotBlock}`}</p></div><strong>{holdersLoading ? "…" : holders.length.toLocaleString("en-US")} holders</strong></div>
      {holdersLoading ? <p className="creator-data-status" role="status">Reading holder balances…</p> : holdersError ? <p className="creator-data-status" role="alert">Holder balances are unavailable. {holdersError}</p> : holders.length === 0 ? <p className="creator-data-status">No direct holders found yet.</p> : <><div className="creator-table-wrap" tabIndex={0} aria-label="Top holders table, scroll horizontally for all columns"><table className="creator-table"><thead><tr><th scope="col">Rank</th><th scope="col">Wallet</th><th scope="col">Balance</th><th scope="col">Share of direct holdings</th></tr></thead><tbody>{visibleHolders.map((holder, index) => <tr key={holder.address}><td>{String(index + 1).padStart(2, "0")}</td><td><a href={`${activeExplorerUrl}/address/${holder.address}`} target="_blank" rel="noreferrer" title={holder.address}>{shortAddress(holder.address)} ↗</a></td><td>{amount(holder.balance)} {token.symbol}</td><td>{directBalance > 0n ? (Number(holder.balance * 10_000n / directBalance) / 100).toFixed(2) : "0.00"}%</td></tr>)}</tbody></table></div>{holders.length > 10 && <button type="button" className="market-refresh creator-show-more" onClick={() => setShowAllHolders((value) => !value)}>{showAllHolders ? "Show top 10" : `Show all ${holders.length} holders`}</button>}</>}
    </section>
  </div>;
}

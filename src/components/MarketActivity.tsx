import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatEther, type Address } from "viem";
import { formatAddress } from "../lib/format.js";
import { formatMarketAge } from "../lib/marketDisplay";
import { type TradeActivity } from "../lib/marketChart";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import { activeExplorerUrl } from "../lib/web3";
import type { Token } from "../types";
import { useAccount } from "wagmi";
import { fetchMarketTradesPage } from "../markets/api";
import { socialApi, socialApiConfigured } from "../social/api";
import { useSocialAuth } from "../social/useSocialAuth";
import { UsdAmount } from "./UsdAmount";

const PAGE_SIZE = 25;

function ParticipantLink({ address, role }: { address: Address; role: TradeActivity["participantRole"] }) {
  const { data: name } = useQuery({
    queryKey: ["rns", "primary", address.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(address, signal),
    staleTime: 60_000,
    retry: 1,
  });
  const label = role === "recipient" ? "Pool recipient" : "Trader";
  return <a className="market-activity-trader" href={`/profile/${address}`} title={`${label}: ${address}`} aria-label={name ? `View ${name}'s Curveball profile` : `View ${address}'s Curveball profile`}>
    <span className={name ? "market-activity-name" : ""}>{name ?? formatAddress(address)}</span>
  </a>;
}

function tokenAmount(value: bigint) {
  const number = Number(formatEther(value));
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function TradeContext({ trade, token }: { trade: TradeActivity; token: Token }) {
  const { address } = useAccount();
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(trade.note ?? "");
  const [error, setError] = useState("");
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["markets", "trades"] }), queryClient.invalidateQueries({ queryKey: ["social"] })]);
  const save = useMutation({ mutationFn: async () => { await ensureAuthenticated(); return socialApi.saveTradeNote(trade.id!, note); }, onSuccess: async () => { setEditing(false); await refresh(); }, onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save note.") });
  const react = useMutation({ mutationFn: async () => { await ensureAuthenticated(); return socialApi.reactToTrade(trade.id!, !trade.reacted); }, onSuccess: refresh, onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not react.") });
  const report = useMutation({ mutationFn: async () => { await ensureAuthenticated(); return socialApi.report(trade.trader, "harmful_content", "Trade note", trade.id); }, onSuccess: () => setError("Report submitted for review."), onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not report note.") });
  if (!trade.id || trade.venue !== "curve") return trade.note ? <small>{trade.note}</small> : null;
  return <div className="market-trade-context">
    {trade.note ? <p>{trade.note}</p> : null}
    <button type="button" aria-label={`${trade.reacted ? "Remove reaction from" : "React to"} trade, ${trade.reactionCount ?? 0} reactions`} aria-pressed={Boolean(trade.reacted)} disabled={react.isPending} onClick={() => react.mutate()}>♥ {trade.reactionCount ?? 0}</button>
    {address?.toLowerCase() === trade.trader.toLowerCase() ? <button type="button" onClick={() => { setNote(trade.note ?? ""); setEditing(true); }}>{trade.note ? "Edit note" : "Add note"}</button> : <button type="button" disabled={report.isPending} onClick={() => report.mutate()}>Report trade</button>}
    {editing ? <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><label htmlFor={`market-note-${trade.id}`}>Note on {token.symbol} trade</label><textarea id={`market-note-${trade.id}`} maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} /><button type="button" onClick={() => setEditing(false)}>Cancel</button><button type="submit" disabled={save.isPending}>Save</button></form> : null}
    {error ? <small role="status">{error}</small> : null}
  </div>;
}

function TradeRow({ trade, token }: { trade: TradeActivity; token: Token }) {
  const date = new Date(trade.timestamp * 1000);
  const quote = Number(formatEther(trade.quoteAmount));
  const tokens = Number(formatEther(trade.tokenAmount));
  const price = tokens > 0 ? quote / tokens : null;
  return <tr className={trade.isBuy ? "market-activity-buy" : "market-activity-sell"}>
    <td><span className={`market-activity-side ${trade.isBuy ? "buy" : "sell"}`}><span aria-hidden="true">{trade.isBuy ? "↗" : "↘"}</span>{trade.isBuy ? "Buy" : "Sell"}</span></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.quoteAmount)}</strong></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.tokenAmount)}</strong></td>
    <td className="market-activity-number market-activity-price"><strong><UsdAmount weth={price} /></strong></td>
    <td className="market-activity-person"><ParticipantLink address={trade.trader} role={trade.participantRole} /><a className="market-activity-txn" href={`${activeExplorerUrl}/tx/${trade.transactionHash}`} target="_blank" rel="noreferrer" title="View transaction on explorer" aria-label={`View ${trade.isBuy ? "buy" : "sell"} transaction on explorer`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-8 8M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" /></svg>
    </a><TradeContext trade={trade} token={token} /></td>
    <td className="market-activity-age"><time dateTime={date.toISOString()} title={date.toLocaleString()}>{formatMarketAge(date.toISOString())}</time></td>
  </tr>;
}

export function MarketActivity({ token, trades, loading, error }: {
  token: Token;
  trades: readonly TradeActivity[];
  loading: boolean;
  error: boolean;
}) {
  const [page, setPage] = useState(0);
  const { address } = useAccount();
  const history = useInfiniteQuery({
    queryKey: ["markets", "trades", token.address.toLowerCase(), address?.toLowerCase(), "history"],
    queryFn: ({ pageParam, signal }) => fetchMarketTradesPage(token.address, pageParam || undefined, signal),
    initialPageParam: "",
    getNextPageParam: (result) => result.nextCursor || undefined,
    enabled: socialApiConfigured,
    staleTime: 8_000,
    refetchInterval: 30_000,
  });
  const allTrades = socialApiConfigured ? history.data?.pages.flatMap((result) => result.items) ?? [] : trades;
  const historyLoading = socialApiConfigured ? history.isPending : loading;
  const historyError = socialApiConfigured ? history.isError : error;
  const pageCount = Math.max(1, Math.ceil(allTrades.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstTrade = currentPage * PAGE_SIZE;
  const visibleTrades = allTrades.slice(firstTrade, firstTrade + PAGE_SIZE);

  return <section className="market-activity" aria-labelledby="market-activity-title" aria-busy={historyLoading}>
    <header className="market-activity-head">
      <h2 id="market-activity-title">Trade history</h2>
    </header>
    {historyLoading ? <p className="market-activity-status" role="status">Reading confirmed trades…</p> :
      historyError ? <p className="market-activity-status" role="alert">Trade history is unavailable right now.</p> :
      allTrades.length === 0 ? <p className="market-activity-status">No confirmed trades yet.</p> :
      <div className="market-activity-scroll" tabIndex={0} aria-label="Trade history table. Scroll horizontally to see all columns.">
        <table>
          <thead><tr>
            <th scope="col">Side</th>
            <th scope="col">{token.quoteSymbol ?? "WETH"}</th>
            <th scope="col">{token.symbol}</th>
            <th scope="col">Price</th>
            <th scope="col">Trader</th><th scope="col">Age</th>
          </tr></thead>
          <tbody>{visibleTrades.map((trade) => <TradeRow key={`${trade.transactionHash}-${trade.logIndex}`} trade={trade} token={token} />)}</tbody>
        </table>
      </div>}
    {!historyLoading && !historyError && allTrades.length > 0 && <footer className="market-activity-footer">
      <span>{(firstTrade + 1).toLocaleString("en-US")}–{(firstTrade + visibleTrades.length).toLocaleString("en-US")} of {allTrades.length.toLocaleString("en-US")}{history.hasNextPage ? "+" : ""}</span>
      <nav className="market-activity-pages" aria-label="Trade history pages">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage + 1} of {pageCount}</span>
        <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav>
      {history.hasNextPage ? <button type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? "Loading…" : "Load more trades"}</button> : null}
    </footer>}
  </section>;
}

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatEther, type Address } from "viem";
import { formatAddress } from "../lib/format.js";
import { type TradeActivity } from "../lib/marketChart";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import { activeExplorerUrl } from "../lib/web3";
import type { Token } from "../types";
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
  return <span className="market-activity-participant">
    <small>{label}</small>
    <a className="market-activity-trader" href={`/profile/${address}`} title={`${label}: ${address}`} aria-label={name ? `View ${name}'s Curveball profile` : `View ${address}'s Curveball profile`}>
      <span className={name ? "market-activity-name" : ""}>{name ?? formatAddress(address)}</span>
    </a>
  </span>;
}

function tokenAmount(value: bigint) {
  const number = Number(formatEther(value));
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function TradeRow({ trade }: { trade: TradeActivity }) {
  const date = new Date(trade.timestamp * 1000);
  const quote = Number(formatEther(trade.quoteAmount));
  return <tr className={trade.isBuy ? "market-activity-buy" : "market-activity-sell"}>
    <td className="market-activity-date"><time dateTime={date.toISOString()} title={date.toLocaleString()}>
      <span>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      <small>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
    </time></td>
    <td><span className={`market-activity-side ${trade.isBuy ? "buy" : "sell"}`}>{trade.isBuy ? "Buy" : "Sell"}</span></td>
    <td className="market-activity-number market-activity-usd"><strong><UsdAmount weth={quote} /></strong></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.tokenAmount)}</strong></td>
    <td><ParticipantLink address={trade.trader} role={trade.participantRole} /></td>
    <td className="market-activity-txn"><a href={`${activeExplorerUrl}/tx/${trade.transactionHash}`} target="_blank" rel="noreferrer" title="View transaction on explorer" aria-label={`View ${trade.isBuy ? "buy" : "sell"} transaction on explorer`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-8 8M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" /></svg>
    </a></td>
  </tr>;
}

export function MarketActivity({ token, trades, loading, error }: {
  token: Token;
  trades: readonly TradeActivity[];
  loading: boolean;
  error: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstTrade = currentPage * PAGE_SIZE;
  const visibleTrades = trades.slice(firstTrade, firstTrade + PAGE_SIZE);

  return <section className="market-activity" aria-labelledby="market-activity-title" aria-busy={loading}>
    <header className="market-activity-head">
      <h2 id="market-activity-title">Trade history</h2>
    </header>
    {loading ? <p className="market-activity-status" role="status">Reading on-chain trades…</p> :
      error ? <p className="market-activity-status" role="alert">Trade history is unavailable right now.</p> :
      trades.length === 0 ? <p className="market-activity-status">No confirmed trades yet.</p> :
      <div className="market-activity-scroll" tabIndex={0} aria-label="Trade history table. Scroll horizontally to see all columns.">
        <table>
          <thead><tr>
            <th scope="col">Date</th><th scope="col">Type</th>
            <th scope="col">USD</th>
            <th scope="col">{token.symbol}</th>
            <th scope="col">Wallet</th><th scope="col">Txn</th>
          </tr></thead>
          <tbody>{visibleTrades.map((trade) => <TradeRow key={`${trade.transactionHash}-${trade.logIndex}`} trade={trade} />)}</tbody>
        </table>
      </div>}
    {!loading && !error && trades.length > 0 && <footer className="market-activity-footer">
      <span>{(firstTrade + 1).toLocaleString("en-US")}–{(firstTrade + visibleTrades.length).toLocaleString("en-US")} of {trades.length.toLocaleString("en-US")}</span>
      <nav className="market-activity-pages" aria-label="Trade history pages">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage + 1} of {pageCount}</span>
        <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
      </nav>
    </footer>}
  </section>;
}

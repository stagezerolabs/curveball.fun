import { useState } from "react";
import { formatEther } from "viem";
import { formatMarketAge } from "../lib/marketDisplay";
import { type TradeActivity } from "../lib/marketChart";
import { activeExplorerUrl } from "../lib/web3";
import type { Token } from "../types";

const PAGE_SIZE = 10;

function tokenAmount(value: bigint) {
  const number = Number(formatEther(value));
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function TradeRow({ trade }: { trade: TradeActivity }) {
  const date = new Date(trade.timestamp * 1000);
  const transactionUrl = `${activeExplorerUrl}/tx/${trade.transactionHash}`;
  return <tr className={trade.isBuy ? "market-activity-buy" : "market-activity-sell"}>
    <td><a
      className={`market-activity-side ${trade.isBuy ? "buy" : "sell"}`}
      href={transactionUrl}
      target="_blank"
      rel="noreferrer"
      title="View transaction on explorer"
      aria-label={`View ${trade.isBuy ? "buy" : "sell"} transaction on explorer`}
    >{trade.isBuy ? "Buy" : "Sell"}</a></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.quoteAmount)}</strong></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.tokenAmount)}</strong></td>
    <td className="market-activity-age"><time dateTime={date.toISOString()} title={date.toLocaleString()}>{formatMarketAge(date.toISOString())}</time></td>
  </tr>;
}

export function MarketActivity({ token, trades, loading, error, followingTraderCount = 0 }: {
  token: Token;
  trades: readonly TradeActivity[];
  loading: boolean;
  error: boolean;
  followingTraderCount?: number;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstTrade = currentPage * PAGE_SIZE;
  const visibleTrades = trades.slice(firstTrade, firstTrade + PAGE_SIZE);

  return <section className="market-activity" aria-labelledby="market-activity-title" aria-busy={loading}>
    <header className="market-activity-head">
      <h2 id="market-activity-title">Trade history</h2>
      {followingTraderCount > 0 ? <span className="market-activity-follows">{followingTraderCount} {followingTraderCount === 1 ? "wallet" : "wallets"} you follow traded here</span> : null}
    </header>
    {loading ? <p className="market-activity-status" role="status">Reading on-chain trades…</p> :
      error ? <p className="market-activity-status" role="alert">Trade history is unavailable right now.</p> :
      trades.length === 0 ? <p className="market-activity-status">No confirmed trades yet.</p> :
      <div className="market-activity-scroll" tabIndex={0} aria-label="Trade history table. Scroll horizontally to see all columns.">
        <table className={visibleTrades.length === PAGE_SIZE ? "market-activity-table-filled" : undefined}>
          <thead><tr>
            <th scope="col">Side</th>
            <th scope="col">{token.quoteSymbol ?? "WETH"}</th>
            <th scope="col">{token.symbol}</th>
            <th scope="col">Age</th>
          </tr></thead>
          <tbody>{visibleTrades.map((trade) => <TradeRow
            key={`${trade.transactionHash}-${trade.logIndex}`}
            trade={trade}
          />)}</tbody>
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

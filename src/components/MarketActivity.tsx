import { useState } from "react";
import { formatEther } from "viem";
import { formatAddress } from "../lib/format.js";
import { formatMarketAge } from "../lib/marketDisplay";
import { type TradeActivity } from "../lib/marketChart";
import { activeExplorerUrl } from "../lib/web3";
import { TraderName } from "../social/TraderIdentity";
import { formatUsd, useEthUsdRate } from "./UsdAmount";
import type { Navigate, Token } from "../types";

const PAGE_SIZE = 10;

function tokenAmount(value: bigint) {
  const number = Number(formatEther(value));
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function averageUsdPrice(
  quoteAmount: bigint,
  tokenAmountValue: bigint,
  usdPerEth: number | null,
) {
  if (tokenAmountValue === 0n || usdPerEth === null) return "—";
  const price =
    (Number(formatEther(quoteAmount)) * usdPerEth) /
    Number(formatEther(tokenAmountValue));
  if (!Number.isFinite(price)) return "—";
  if (price > 0 && price < 0.000000000001) return "<$0.000000000001";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits:
      price >= 1 ? 2 : price >= 0.01 ? 4 : price >= 0.0001 ? 6 : 12,
  }).format(price);
}

function TradeRow({
  trade,
  usdPerEth,
  navigate,
}: {
  trade: TradeActivity;
  usdPerEth: number | null;
  navigate: Navigate;
}) {
  const date = new Date(trade.timestamp * 1000);
  const transactionUrl = `${activeExplorerUrl}/tx/${trade.transactionHash}`;
  return (
    <tr
      className={trade.isBuy ? "market-activity-buy" : "market-activity-sell"}
    >
      <td>
        <span
          className={`market-activity-side ${trade.isBuy ? "buy" : "sell"}`}
        >
          {trade.isBuy ? "Buy" : "Sell"}
        </span>
      </td>
      <td className="market-activity-number">
        <strong>
          {usdPerEth === null
            ? "—"
            : formatUsd(Number(formatEther(trade.quoteAmount)) * usdPerEth)}
        </strong>
      </td>
      <td className="market-activity-number">
        <strong>{tokenAmount(trade.tokenAmount)}</strong>
      </td>
      <td className="market-activity-number market-activity-price">
        <strong>
          {averageUsdPrice(trade.quoteAmount, trade.tokenAmount, usdPerEth)}
        </strong>
        <small>USD per token</small>
      </td>
      <td className="market-activity-wallet">
        <TraderName address={trade.trader} navigate={navigate} />
        <span>
          {trade.participantRole === "recipient" ? "Recipient" : "Trader"}
          {trade.isFollowed ? (
            <span className="market-activity-following">Following</span>
          ) : null}
        </span>
      </td>
      <td className="market-activity-age">
        <time dateTime={date.toISOString()} title={date.toLocaleString()}>
          {formatMarketAge(date.toISOString())}
        </time>
        <small>
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year:
              date.getFullYear() === new Date().getFullYear()
                ? undefined
                : "numeric",
          })}
          {" · "}
          {date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </small>
      </td>
      <td className="market-activity-transaction">
        <a
          href={transactionUrl}
          target="_blank"
          rel="noreferrer"
          title={trade.transactionHash}
          aria-label={`View transaction ${trade.transactionHash} on explorer`}
        >
          {formatAddress(trade.transactionHash)} ↗
        </a>
        <small>Block {trade.blockNumber.toLocaleString("en-US")}</small>
      </td>
    </tr>
  );
}

export function MarketActivity({
  token,
  trades,
  loading,
  error,
  navigate,
  followingTraderCount = 0,
}: {
  token: Token;
  trades: readonly TradeActivity[];
  loading: boolean;
  error: boolean;
  navigate: Navigate;
  followingTraderCount?: number;
}) {
  const [page, setPage] = useState(0);
  const usdPerEth = useEthUsdRate();
  const pageCount = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstTrade = currentPage * PAGE_SIZE;
  const visibleTrades = trades.slice(firstTrade, firstTrade + PAGE_SIZE);

  return (
    <section
      className="market-activity"
      aria-labelledby="market-activity-title"
      aria-busy={loading}
    >
      <header className="market-activity-head">
        <h2 id="market-activity-title">Trade history</h2>
        {followingTraderCount > 0 ? (
          <span className="market-activity-follows">
            {followingTraderCount}{" "}
            {followingTraderCount === 1 ? "wallet" : "wallets"} you follow
            traded here
          </span>
        ) : null}
      </header>
      {loading ? (
        <p className="market-activity-status" role="status">
          Reading on-chain trades…
        </p>
      ) : error ? (
        <p className="market-activity-status" role="alert">
          Trade history is unavailable right now.
        </p>
      ) : trades.length === 0 ? (
        <p className="market-activity-status">No confirmed trades yet.</p>
      ) : (
        <div
          className="market-activity-scroll"
          tabIndex={0}
          aria-label="Trade history table. Scroll horizontally to see all columns."
        >
          <table
            className={
              visibleTrades.length === PAGE_SIZE
                ? "market-activity-table-filled"
                : undefined
            }
          >
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th
                  scope="col"
                  title="Approximate USD at the current ETH/USD rate"
                >
                  Total (USD)
                </th>
                <th scope="col">Amount ({token.symbol})</th>
                <th
                  scope="col"
                  title="Approximate USD per token at the current ETH/USD rate"
                >
                  Avg. price
                </th>
                <th scope="col">Wallet</th>
                <th scope="col">Time</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((trade) => (
                <TradeRow
                  key={`${trade.transactionHash}-${trade.logIndex}`}
                  trade={trade}
                  usdPerEth={usdPerEth}
                  navigate={navigate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && trades.length > 0 && (
        <footer className="market-activity-footer">
          <span>
            {(firstTrade + 1).toLocaleString("en-US")}–
            {(firstTrade + visibleTrades.length).toLocaleString("en-US")} of{" "}
            {trades.length.toLocaleString("en-US")}
          </span>
          <nav
            className="market-activity-pages"
            aria-label="Trade history pages"
          >
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </nav>
        </footer>
      )}
    </section>
  );
}

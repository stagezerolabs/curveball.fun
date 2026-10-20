import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatEther, type Address } from "viem";
import { AppLink } from "./Navigation";
import { formatAddress } from "../lib/format.js";
import { formatMarketAge } from "../lib/marketDisplay";
import { type TradeActivity } from "../lib/marketChart";
import { activeExplorerUrl } from "../lib/web3";
import { socialApi, socialApiConfigured } from "../social/api";
import { useTraderName } from "../social/useTraderName";
import { useSocialAuth } from "../social/useSocialAuth";
import type { Navigate, Token } from "../types";
import { UsdAmount } from "./UsdAmount";

const PAGE_SIZE = 25;

function ParticipantLink({ trade, tokenAddress, navigate }: {
  trade: TradeActivity;
  tokenAddress: Address;
  navigate: Navigate;
}) {
  const { name, label } = useTraderName(trade.trader);
  const role = trade.participantRole === "recipient" ? "Pool recipient" : "Trader";
  return <div className="market-activity-person-cell">
    <AppLink
      className="market-activity-trader"
      route="trader"
      params={{ address: trade.trader }}
      navigate={navigate}
      title={`${role}: ${trade.trader}`}
      aria-label={name ? `View ${name}'s Curveball profile` : `View ${trade.trader}'s Curveball profile`}
    >
      <span className={name ? "market-activity-name" : ""}>{label}</span>
    </AppLink>
    {trade.isFollowed ? <span className="market-activity-following">Following</span> : null}
    <ConvictionButton trade={trade} tokenAddress={tokenAddress} />
    {trade.note ? <p className="market-activity-note" title={trade.note}>{trade.note}</p> : null}
  </div>;
}

/** Conviction is the social read of a trade: how many wallets stood behind this one. */
function ConvictionButton({ trade, tokenAddress }: { trade: TradeActivity; tokenAddress: Address }) {
  const queryClient = useQueryClient();
  const { ensureAuthenticated } = useSocialAuth();
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      await ensureAuthenticated();
      return socialApi.reactToTrade(trade.id!, !trade.reacted);
    },
    onSuccess: () => {
      setFailed(false);
      void queryClient.invalidateQueries({ queryKey: ["markets", "trades", tokenAddress] });
    },
    onError: () => setFailed(true),
  });

  if (!socialApiConfigured || !trade.id) return null;
  const count = trade.reactionCount ?? 0;
  return <button
    type="button"
    className={`market-activity-conviction${trade.reacted ? " active" : ""}`}
    disabled={mutation.isPending}
    aria-pressed={Boolean(trade.reacted)}
    title={failed ? "Could not update Conviction." : trade.reacted ? "Remove your Conviction" : "Show Conviction"}
    onClick={() => mutation.mutate()}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16.5S3.5 12.6 3.5 8.2A3.7 3.7 0 0 1 10 6a3.7 3.7 0 0 1 6.5 2.2c0 4.4-6.5 8.3-6.5 8.3Z" /></svg>
    <span>{count ? count : ""}</span>
  </button>;
}

function tokenAmount(value: bigint) {
  const number = Number(formatEther(value));
  if (number === 0) return "0";
  if (number < 0.000001) return "<0.000001";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function TradeRow({ trade, tokenAddress, navigate }: { trade: TradeActivity; tokenAddress: Address; navigate: Navigate }) {
  const date = new Date(trade.timestamp * 1000);
  const quote = Number(formatEther(trade.quoteAmount));
  const tokens = Number(formatEther(trade.tokenAmount));
  const price = tokens > 0 ? quote / tokens : null;
  return <tr className={trade.isBuy ? "market-activity-buy" : "market-activity-sell"}>
    <td><span className={`market-activity-side ${trade.isBuy ? "buy" : "sell"}`}><span aria-hidden="true">{trade.isBuy ? "↗" : "↘"}</span>{trade.isBuy ? "Buy" : "Sell"}</span></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.quoteAmount)}</strong></td>
    <td className="market-activity-number"><strong>{tokenAmount(trade.tokenAmount)}</strong></td>
    <td className="market-activity-number market-activity-price"><strong><UsdAmount weth={price} /></strong></td>
    <td className="market-activity-person"><ParticipantLink trade={trade} tokenAddress={tokenAddress} navigate={navigate} /><a className="market-activity-txn" href={`${activeExplorerUrl}/tx/${trade.transactionHash}`} target="_blank" rel="noreferrer" title="View transaction on explorer" aria-label={`View ${trade.isBuy ? "buy" : "sell"} transaction on explorer`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-8 8M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" /></svg>
    </a></td>
    <td className="market-activity-age"><time dateTime={date.toISOString()} title={date.toLocaleString()}>{formatMarketAge(date.toISOString())}</time></td>
  </tr>;
}

export function MarketActivity({ token, trades, loading, error, followingTraderCount = 0, navigate }: {
  token: Token;
  trades: readonly TradeActivity[];
  loading: boolean;
  error: boolean;
  followingTraderCount?: number;
  navigate: Navigate;
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
        <table>
          <thead><tr>
            <th scope="col">Side</th>
            <th scope="col">{token.quoteSymbol ?? "WETH"}</th>
            <th scope="col">{token.symbol}</th>
            <th scope="col">Price</th>
            <th scope="col">Trader</th><th scope="col">Age</th>
          </tr></thead>
          <tbody>{visibleTrades.map((trade) => <TradeRow
            key={`${trade.transactionHash}-${trade.logIndex}`}
            trade={trade}
            tokenAddress={token.address}
            navigate={navigate}
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

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { formatEther } from "viem";
import { formatEthAmount, formatRelativeTime } from "../lib/format.js";
import type { Navigate } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import type { LeaderboardSnapshot, LeaderboardTrader } from "./types";

type SortKey = "rank" | "return" | "pnl" | "trades" | "markets";
type View = "cards" | "rows";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "rank", label: "Rank" },
  { value: "return", label: "Estimated return" },
  { value: "pnl", label: "Net P&L" },
  { value: "trades", label: "Trades" },
  { value: "markets", label: "Markets" },
];

function weth(value: string | undefined) {
  if (value === undefined) return "—";
  return `${formatEthAmount(Number(formatEther(BigInt(value))))} WETH`;
}

function percent(bps: number | null | undefined) {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
}

function netPnl(trader: LeaderboardTrader) {
  const metrics = trader.publishedMetrics || {};
  if (metrics.netPnlWei !== undefined) return metrics.netPnlWei;
  if (metrics.realizedPnlWei !== undefined && metrics.unrealizedPnlWei !== undefined) {
    return (BigInt(metrics.realizedPnlWei) + BigInt(metrics.unrealizedPnlWei)).toString();
  }
  return undefined;
}

function compareNullable(a: number | bigint | null | undefined, b: number | bigint | null | undefined) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return a === b ? 0 : a > b ? -1 : 1;
}

function compareTraders(a: LeaderboardTrader, b: LeaderboardTrader, sort: SortKey) {
  if (sort === "rank") return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  if (sort === "return") return compareNullable(a.publishedMetrics?.returnBps, b.publishedMetrics?.returnBps);
  if (sort === "pnl") {
    const aPnl = netPnl(a);
    const bPnl = netPnl(b);
    return compareNullable(aPnl === undefined ? null : BigInt(aPnl), bPnl === undefined ? null : BigInt(bPnl));
  }
  if (sort === "trades") return compareNullable(a.publishedMetrics?.tradeCount ?? a.stats.tradeCount, b.publishedMetrics?.tradeCount ?? b.stats.tradeCount);
  return compareNullable(a.publishedMetrics?.marketCount ?? a.stats.marketsTraded, b.publishedMetrics?.marketCount ?? b.stats.marketsTraded);
}

function TraderCard({ trader, rank, category, view, navigate }: {
  trader: LeaderboardTrader;
  rank: number;
  category: "consistent" | "new";
  view: View;
  navigate: Navigate;
}) {
  const metrics = trader.publishedMetrics || {};
  const tradeCount = metrics.tradeCount ?? trader.stats.tradeCount;
  const marketCount = metrics.marketCount ?? trader.stats.marketsTraded;
  const pnl = netPnl(trader);
  return <li className={`pulse-trader-card ${view === "rows" ? "is-row" : ""}`}>
    <div className="pulse-trader-card-head">
      <span className="pulse-trader-rank" aria-label={`Rank ${rank}`}>#{String(rank).padStart(2, "0")}</span>
      <TraderIdentity address={trader.address} displayName={trader.displayName} navigate={navigate} />
      <span className="pulse-trader-status">{metrics.sampleLabel === "provisional" ? "Provisional" : "Qualified"}</span>
    </div>
    <dl className="pulse-trader-card-metrics">
      <div className={category === "consistent" ? "featured" : ""}><dt>Est. return</dt><dd>{percent(metrics.returnBps)}</dd></div>
      <div className={category === "new" ? "featured" : ""}><dt>Net P&L</dt><dd>{weth(pnl)}</dd></div>
      <div><dt>Trades</dt><dd>{tradeCount}</dd></div>
    </dl>
    <div className="pulse-trader-card-footer">
      <span>{marketCount} {marketCount === 1 ? "market" : "markets"}{metrics.tradingDayCount != null ? ` · ${metrics.tradingDayCount} trading days` : ""}</span>
      {metrics.investedWei !== undefined ? <span>{weth(metrics.investedWei)} bought</span> : null}
    </div>
  </li>;
}

export function PulseTraders({ category, data, navigate }: {
  category: "consistent" | "new";
  data: LeaderboardSnapshot;
  navigate: Navigate;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const [view, setView] = useState<View>("cards");
  const isRecord = category === "consistent";
  if (data.methodologyVersion && data.methodologyVersion !== "curve-known-basis-v2") {
    return <div className="social-feed-state" role="status"><strong>Updated rankings are on their way.</strong><p>The latest published snapshot uses an earlier method. Qualified rankings will appear after the next snapshot is published.</p></div>;
  }
  const publishedAt = data.publishedAt ?? data.items[0]?.publishedAt;
  const query = search.trim().toLowerCase();
  const visible = data.items
    .map((trader, index) => ({ trader, rank: Number.isFinite(trader.rank) && trader.rank > 0 ? trader.rank : index + 1 }))
    .filter(({ trader }) => !query || trader.displayName?.toLowerCase().includes(query) || trader.address.toLowerCase().includes(query))
    .sort((a, b) => compareTraders(a.trader, b.trader, sort) || a.rank - b.rank);

  return <>
    <div className="pulse-board-tools">
      <div className="pulse-board-search">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.7" /><path d="m13.2 13.2 4.1 4.1" /></svg>
        <label htmlFor="pulse-trader-search" className="visually-hidden">Search traders or wallets</label>
        <input id="pulse-trader-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search traders or wallets" />
      </div>
      <div className="pulse-board-actions">
        <Menu.Root>
          <Menu.Trigger className="pulse-sort-trigger">Sort <strong>{SORT_OPTIONS.find((option) => option.value === sort)?.label}</strong><span aria-hidden="true">⌄</span></Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="pulse-sort-positioner" sideOffset={6} align="end">
              <Menu.Popup className="pulse-sort-menu" aria-label="Sort leaderboard">
                <Menu.RadioGroup value={sort} onValueChange={(value) => setSort(value as SortKey)}>
                  {SORT_OPTIONS.map((option) => <Menu.RadioItem key={option.value} value={option.value} closeOnClick className="pulse-sort-option">
                    <span aria-hidden="true"><Menu.RadioItemIndicator>✓</Menu.RadioItemIndicator></span>{option.label}
                  </Menu.RadioItem>)}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <div className="pulse-view-switch" role="group" aria-label="Leaderboard display">
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><span aria-hidden="true">▦</span> Cards</button>
          <button type="button" aria-pressed={view === "rows"} onClick={() => setView("rows")}><span aria-hidden="true">☷</span> Rows</button>
        </div>
      </div>
    </div>
    {data.items.length ? visible.length ? <ol className={`pulse-trader-list ${view === "rows" ? "is-rows" : ""}`} aria-label={isRecord ? "Track record ranking" : "Emerging trader ranking"}>
      {visible.map(({ trader, rank }) => <TraderCard key={trader.address} trader={trader} rank={rank} category={category} view={view} navigate={navigate} />)}
    </ol> : <div className="social-feed-state" role="status"><strong>No matching traders.</strong><p>Try a different name or wallet address.</p></div>
      : <div className="social-feed-state"><strong>No traders qualify yet.</strong><p>Rankings appear after traders meet the activity and accounting requirements.</p></div>}
    {publishedAt ? <p className="pulse-context" title={new Date(publishedAt).toLocaleString()}>Snapshot {formatRelativeTime(publishedAt)}.</p> : null}
    <details className="pulse-methodology">
      <summary>How these ranks are calculated</summary>
      <p>{isRecord
        ? "Track record requires at least 6 trades across 3 UTC days and 2 markets, at least 0.01 WETH in buys, positive estimated net P&L, and priced open positions. Rank is estimated net P&L divided by cumulative buy spend."
        : "Emerging requires a first trade within 14 days, at least 4 trades across 2 UTC days and 2 markets, at least 0.01 WETH in buys, positive estimated net P&L, and priced open positions. Rank is estimated net P&L."}</p>
      <p>Known-basis curve P&L includes marked open positions. It does not measure complete wallet performance or risk. Multiple wallets may have one owner. Rankings are snapshots, not a recommendation to copy trades.</p>
      {data.methodologyVersion ? <small>Method: {data.methodologyVersion}</small> : null}
    </details>
  </>;
}

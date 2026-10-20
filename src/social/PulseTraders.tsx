import type { Navigate } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import type { LeaderboardSnapshot, LeaderboardTrader } from "./types";

function percent(bps: number | null | undefined) {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
}

function TraderRow({ trader, rank, navigate }: { trader: LeaderboardTrader; rank: number; navigate: Navigate }) {
  const metrics = trader.publishedMetrics || {};
  const returnBps = metrics.returnBps;
  return <li className={`pulse-leader${rank <= 3 ? " is-podium" : ""}`}>
    <span className="pulse-leader-rank" aria-label={`Rank ${rank}`}>{rank}</span>
    <TraderIdentity address={trader.address} navigate={navigate} />
    <div className="pulse-leader-return">
      <strong className={returnBps != null && returnBps < 0 ? "negative" : ""}>{percent(returnBps)}</strong>
      <span>est. return</span>
    </div>
  </li>;
}

export function PulseTraders({ category, data, navigate }: {
  category: "consistent" | "new";
  data: LeaderboardSnapshot;
  navigate: Navigate;
}) {
  const isRecord = category === "consistent";
  const ranked = data.items
    .map((trader, index) => ({ trader, rank: Number.isFinite(trader.rank) && trader.rank > 0 ? trader.rank : index + 1 }))
    .sort((a, b) => a.rank - b.rank);

  return <>
    {ranked.length ? <ol className="pulse-leader-list" aria-label={isRecord ? "Track record ranking" : "Emerging trader ranking"}>
      {ranked.map(({ trader, rank }) => <TraderRow key={trader.address} trader={trader} rank={rank} navigate={navigate} />)}
    </ol> : <div className="social-feed-state"><strong>No traders qualify yet.</strong><p>Rankings appear after traders meet the activity and accounting requirements.</p></div>}
    <details className="pulse-methodology">
      <summary>How ranks are calculated</summary>
      {data.provisional ? <p>No trader qualifies under the current rules yet, so this provisional board ranks every trader by their latest estimated return.</p> : null}
      <p>{isRecord
        ? "Track record requires at least 6 trades across 3 UTC days and 2 markets, at least 0.01 WETH in buys, positive estimated net P&L, and priced open positions. Rank is estimated net P&L divided by cumulative buy spend."
        : "Emerging requires a first trade within 14 days, at least 4 trades across 2 UTC days and 2 markets, at least 0.01 WETH in buys, positive estimated net P&L, and priced open positions. Rank is estimated net P&L."}</p>
      <p>Known-basis curve P&L includes marked open positions. It does not measure complete wallet performance or risk. Multiple wallets may have one owner. Rankings are snapshots, not a recommendation to copy trades.</p>
    </details>
  </>;
}

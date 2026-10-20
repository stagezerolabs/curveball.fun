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

/**
 * Ranking methodology is intentionally not exposed in the product UI: publishing exact thresholds
 * would make the board easier to game. The canonical, tested rules live in
 * `services/social/src/performance.mjs` (`LEADERBOARD_RULES`, `scoreExpressions`, and
 * `eligibleExpressions`). In brief, Track record scores qualified wallets by known-basis estimated
 * return, Emerging scores qualified recent wallets by known-basis estimated net P&L, and the API
 * supplies a return-ranked provisional board when no wallet qualifies.
 */
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
  </>;
}

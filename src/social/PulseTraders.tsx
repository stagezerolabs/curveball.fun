import type { Navigate } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import type { LeaderboardSnapshot, LeaderboardTrader } from "./types";

function percent(bps: number | null | undefined) {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
}

function TraderRow({ trader, rank, category, provisional, navigate }: { trader: LeaderboardTrader; rank: number; category: LeaderboardSnapshot["category"]; provisional: boolean; navigate: Navigate }) {
  const metrics = trader.publishedMetrics || {};
  const returnBps = metrics.returnBps;
  const value = category === "followers" ? String(trader.followers ?? 0)
    : category === "trending" ? String(provisional ? metrics.recentTradeCount ?? 0 : metrics.recentTradingDayCount ?? 0)
      : category === "new" ? `${Number(BigInt(metrics.netPnlWei ?? "0") / 10n ** 15n) / 1000} WETH`
        : percent(returnBps);
  const label = { followers: "followers", trending: provisional ? "trades in 7 days" : "recent trading days", new: "est. net P&L", consistent: "est. return" }[category];
  return <li className={`pulse-leader${rank <= 3 ? " is-podium" : ""}`}>
    <span className="pulse-leader-rank" aria-label={`Rank ${rank}`}>{rank}</span>
    <TraderIdentity address={trader.address} displayName={trader.displayName} navigate={navigate} />
    <div className="pulse-leader-return">
      <strong className={returnBps != null && returnBps < 0 ? "negative" : ""}>{value}</strong>
      <span>{label}</span>
    </div>
  </li>;
}

export function PulseTraders({ category, data, navigate }: {
  category: LeaderboardSnapshot["category"];
  data: LeaderboardSnapshot;
  navigate: Navigate;
}) {
  const isRecord = category === "consistent";
  const categoryLabel = { consistent: "Track record", new: "Emerging", trending: "Active", followers: "Followed" }[category];
  const ranked = data.items
    .map((trader, index) => ({ trader, rank: Number.isFinite(trader.rank) && trader.rank > 0 ? trader.rank : index + 1 }))
    .sort((a, b) => a.rank - b.rank);

  return <>
    {ranked.length ? <ol className="pulse-leader-list" aria-label={`${categoryLabel} ranking`}>
      {ranked.map(({ trader, rank }) => <TraderRow key={trader.address} trader={trader} rank={rank} category={category} provisional={Boolean(data.provisional)} navigate={navigate} />)}
    </ol> : <div className="social-feed-state"><strong>No traders qualify yet.</strong><p>Rankings appear after traders meet the activity and accounting requirements.</p></div>}
    <details className="pulse-methodology">
      <summary>How ranks are calculated</summary>
      {data.provisional ? <p>Provisional preview from the latest stored performance and confirmed activity. Published eligibility and current prices have not been verified.</p> : null}
      <p>{category === "consistent"
        ? "Track record requires at least 6 trades across 3 UTC days and 2 markets, at least 0.01 WETH in buys, positive estimated net P&L, and priced open positions. Rank is estimated net P&L divided by cumulative buy spend."
        : category === "new" ? "Emerging requires a first trade within 14 days, at least 4 trades across 2 UTC days and 2 markets, at least 0.01 WETH in buys, positive estimated net P&L, and priced open positions. Rank is estimated net P&L."
          : category === "trending" ? "Active ranks repeat trading across recent days and markets, with minimum buy spend, positive estimated P&L, and priced open positions."
            : "Followed ranks eligible traders by followers who have also made recorded curve trades."}</p>
      <p>Known-basis curve P&L includes marked open positions. It does not measure complete wallet performance or risk. Multiple wallets may have one owner. Rankings are snapshots, not a recommendation to copy trades.</p>
    </details>
  </>;
}

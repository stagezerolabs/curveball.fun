import { formatUnits } from "viem";
import { formatEthAmount } from "../lib/format.js";
import type { Navigate } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import type {
  LeaderboardCategory,
  LeaderboardRules,
  LeaderboardSnapshot,
  LeaderboardTrader,
  WatchingTrader,
} from "./types";

const P_AND_L_CATEGORIES = new Set<LeaderboardCategory>([
  "consistent",
  "new",
  "trending",
]);

const RANKING_LABELS: Record<LeaderboardCategory, string> = {
  consistent: "Track record ranking",
  new: "Emerging trader ranking",
  trending: "Trending trader ranking",
  followers: "Most followed traders",
};

/** Display-only conversion; wei stays a string/BigInt everywhere else. */
function weth(wei: string | null | undefined) {
  if (!wei) return "0";
  return formatEthAmount(Number(formatUnits(BigInt(wei), 18)));
}

function percent(bps: number | null | undefined) {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Checklist lines generated from the API's public rules; never hard-coded numbers. */
export function requirementLines(
  category: LeaderboardCategory,
  rules: LeaderboardRules,
): string[] {
  const lines: string[] = [];
  if (rules.minQualifyingTrades !== undefined) {
    lines.push(
      rules.minTradeWei
        ? `${plural(rules.minQualifyingTrades, "trade")} of ${weth(rules.minTradeWei)}+ WETH`
        : plural(rules.minQualifyingTrades, "trade"),
    );
  }
  if (rules.minMarkets !== undefined)
    lines.push(plural(rules.minMarkets, "market"));
  if (rules.minActiveDays !== undefined)
    lines.push(plural(rules.minActiveDays, "active day"));
  if (rules.minPeakCapitalWei)
    lines.push(`${weth(rules.minPeakCapitalWei)} WETH peak capital`);
  if (rules.minFirstTradeAgeDays !== undefined)
    lines.push(`First trade ${rules.minFirstTradeAgeDays}+ days ago`);
  if (rules.maxFirstTradeAgeDays !== undefined)
    lines.push(`First trade within the last ${rules.maxFirstTradeAgeDays} days`);
  if (rules.maxLastTradeAgeDays !== undefined)
    lines.push(`Traded within the last ${rules.maxLastTradeAgeDays} days`);
  if (rules.windowDays !== undefined)
    lines.push(`Counted over the last ${rules.windowDays} days`);
  if (rules.maxSingleMarketShareBps !== undefined)
    lines.push(
      `At most ${rules.maxSingleMarketShareBps / 100}% of profit from one market`,
    );
  if (P_AND_L_CATEGORIES.has(category)) lines.push("Net profit after fees");
  if (category === "followers") lines.push("At least one active follower");
  return lines;
}

function CheckIcon() {
  return (
    <svg
      className="pulse-check-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.8 10.2l2.2 2.2 4.2-4.6" />
    </svg>
  );
}

function TraderRow({
  trader,
  rank,
  category,
  navigate,
}: {
  trader: LeaderboardTrader;
  rank: number;
  category: LeaderboardCategory;
  navigate: Navigate;
}) {
  const metrics = trader.publishedMetrics || {};
  const isFollowers = category === "followers";
  const returnBps = metrics.returnBps;
  return (
    <li className={`pulse-leader${rank <= 3 ? " is-podium" : ""}`}>
      <span className="pulse-leader-rank" aria-label={`Rank ${rank}`}>
        {rank}
      </span>
      <TraderIdentity address={trader.address} navigate={navigate} />
      <div className="pulse-leader-return">
        {isFollowers ? (
          <>
            <strong>{metrics.eligibleFollowerCount ?? trader.followers ?? 0}</strong>
            <span>followers</span>
          </>
        ) : (
          <strong
            className={returnBps != null && returnBps < 0 ? "negative" : ""}
          >
            {percent(returnBps)}
          </strong>
        )}
      </div>
    </li>
  );
}

function WatchingRow({
  trader,
  navigate,
}: {
  trader: WatchingTrader;
  navigate: Navigate;
}) {
  const trades = trader.qualifyingTradeCount ?? 0;
  const markets = trader.marketCount ?? 0;
  return (
    <li className="pulse-watching-row">
      <span className="pulse-not-ranked">Not ranked</span>
      <TraderIdentity address={trader.address} navigate={navigate} />
      <div className="pulse-watching-activity">
        <strong>
          {plural(trades, "trade")}, {plural(markets, "market")}
        </strong>
        {trader.requirementsTotal ? (
          <span>
            Meets {trader.requirementsMet ?? 0} of {trader.requirementsTotal}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function PulseTraders({
  category,
  data,
  navigate,
}: {
  category: LeaderboardCategory;
  data: LeaderboardSnapshot;
  navigate: Navigate;
}) {
  const ranked = [...(data.items || [])]
    .map((trader, index) => ({
      trader,
      rank:
        Number.isFinite(trader.rank) && trader.rank > 0
          ? trader.rank
          : index + 1,
    }))
    .sort((a, b) => a.rank - b.rank);
  const watching = data.watching || [];
  const requirements = requirementLines(category, data.rules || {});

  let body;
  if (data.paused) {
    body = (
      <div className="social-feed-state">
        <strong>Rankings paused</strong>
        <p>Rankings will return once fresh results are published.</p>
      </div>
    );
  } else if (data.status === "pending") {
    body = (
      <div className="social-feed-state">
        <strong>Rankings are being calculated.</strong>
      </div>
    );
  } else if (data.status === "ranked" && ranked.length) {
    body = (
      <ol className="pulse-leader-list" aria-label={RANKING_LABELS[category]}>
        {ranked.map(({ trader, rank }) => (
          <TraderRow
            key={trader.address}
            trader={trader}
            rank={rank}
            category={category}
            navigate={navigate}
          />
        ))}
      </ol>
    );
  } else {
    body = (
      <div className="pulse-no-qualifiers">
        <div className="social-feed-state">
          <strong>No traders qualify yet</strong>
          <p>To be ranked, a trader needs:</p>
        </div>
        <ul className="pulse-requirements" aria-label="Requirements to be ranked">
          {requirements.map((line) => (
            <li key={line}>
              <CheckIcon />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        {watching.length ? (
          <section className="pulse-watching">
            <h3>Watching</h3>
            <ul className="pulse-watching-list" aria-label="Watching">
              {watching.map((trader) => (
                <WatchingRow
                  key={trader.address}
                  trader={trader}
                  navigate={navigate}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {data.stale && !data.paused && data.ageMinutes !== null ? (
        <p className="pulse-leader-freshness" role="status">
          Updated {data.ageMinutes} min ago
        </p>
      ) : null}
      {body}
    </>
  );
}

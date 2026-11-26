// Pure shaping of GET /v1/leaderboards/:category. Only snapshots of the current methodology
// are served; there is no provisional ranking fallback.
import { LEADERBOARD_RULES_V3, publicRules } from "../../../analytics/leaderboardRules.mjs";
import { floorDiv } from "../../../analytics/rankingScore.mjs";

export const LEADERBOARD_METHODOLOGY = LEADERBOARD_RULES_V3.methodologyVersion;

const LABELS = {
  consistent: "Track record",
  new: "Emerging",
  trending: "Trending",
  followers: "Most followed",
};

// Watching rows are unranked activity, so only these fields ever leave the API.
const WATCHING_FIELDS = [
  "address",
  "qualifyingTradeCount",
  "marketCount",
  "activeDayCount",
  "requirementsMet",
  "requirementsTotal",
  "lastTradeAt",
];

export function publishedSnapshotQuery(chainId, category) {
  return {
    text: `SELECT id,period,methodology_version,as_of_block,as_of_time,calculated_at,published_at,status,details
      FROM leaderboard_snapshots
      WHERE chain_id=$1 AND category=$2 AND methodology_version=$3 AND published_at IS NOT NULL
      ORDER BY as_of_block DESC,published_at DESC LIMIT 1`,
    values: [chainId, category, LEADERBOARD_METHODOLOGY],
  };
}

function realizedReturnPct(metrics) {
  const cost = BigInt(metrics.realizedCostWei || 0);
  if (cost <= 0n) return null;
  const bps = floorDiv(BigInt(metrics.realizedPnlWei || 0) * 10000n, cost);
  return Number(bps) / 100;
}

function rankedItem(row, snapshot, graph) {
  const metrics = row.published_metrics || {};
  return {
    address: row.address,
    rank: Number(row.rank),
    asOfBlock: String(snapshot.as_of_block),
    publishedAt: snapshot.published_at,
    methodologyVersion: snapshot.methodology_version,
    publishedMetrics: metrics,
    followers: Number(row.follower_count || 0),
    isFollowed: graph.followed.has(row.address),
    confidence: metrics.confidence || "new",
    stats: {
      tradeCount: Number(metrics.tradeCount || 0),
      qualifyingTradeCount: Number(metrics.qualifyingTradeCount || 0),
      realizedPnlWei: String(metrics.realizedPnlWei || 0),
      realizedCostWei: String(metrics.realizedCostWei || 0),
      realizedReturnPct: realizedReturnPct(metrics),
      marketsTraded: Number(metrics.marketCount || 0),
      firstTrade: metrics.firstTradeAt || null,
      lastTrade: metrics.lastTradeAt || null,
    },
  };
}

export function shapeLeaderboardResponse({ category, snapshot, rows, graph, limit, now = new Date() }) {
  const base = {
    category,
    label: LABELS[category],
    methodologyVersion: LEADERBOARD_METHODOLOGY,
  };
  if (!snapshot) {
    return {
      ...base,
      status: "pending",
      asOfBlock: null,
      asOfTime: null,
      publishedAt: null,
      stale: false,
      paused: false,
      ageMinutes: null,
      rules: publicRules(category),
      items: [],
      watching: [],
      progress: [],
    };
  }
  const details = snapshot.details || {};
  const publishedAt = new Date(snapshot.published_at);
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - publishedAt.getTime()) / 60_000));
  const visible = (address) => !graph.blocked.has(address);
  const items =
    snapshot.status === "ranked"
      ? rows
          .filter((row) => visible(row.address))
          .slice(0, limit)
          .map((row) => rankedItem(row, snapshot, graph))
      : [];
  const watching = (details.watching || [])
    .filter((row) => visible(row.address))
    .slice(0, limit)
    .map((row) => ({
      ...Object.fromEntries(WATCHING_FIELDS.map((key) => [key, row[key] ?? null])),
      rank: null,
      provisional: true,
    }));
  return {
    ...base,
    status: snapshot.status || "ranked",
    period: snapshot.period,
    asOfBlock: String(snapshot.as_of_block),
    asOfTime: snapshot.as_of_time,
    calculatedAt: snapshot.calculated_at,
    publishedAt: snapshot.published_at,
    stale: ageMinutes >= LEADERBOARD_RULES_V3.apiStaleMinutes,
    paused: ageMinutes >= LEADERBOARD_RULES_V3.apiPausedMinutes,
    ageMinutes,
    rules: details.rules || publicRules(category),
    items,
    watching,
    progress: details.progress || [],
  };
}

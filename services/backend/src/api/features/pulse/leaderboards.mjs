import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { boundedLimit } from "../../transport/params.mjs";
import { pulseGraph } from "./pulse.mjs";
import { PERFORMANCE_METHODOLOGY } from "../../../analytics/performance.mjs";
import { provisionalLeaderboardSql, followingActivitySql } from "../../../analytics/pulseSql.mjs";

const leaderboardPublicCache = new Map();

async function publishedBoard(category) {
  const cached = leaderboardPublicCache.get(category);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = (async () => {
    const snapshotResult = await pool.query(
      `SELECT id,period,methodology_version,as_of_block,calculated_at,published_at
      FROM leaderboard_snapshots WHERE chain_id=$1 AND category=$2 AND published_at IS NOT NULL
      ORDER BY as_of_block DESC,published_at DESC LIMIT 1`,
      [config.chainId, category],
    );
    const snapshot = snapshotResult.rows[0];
    return { snapshot: snapshot || null };
  })();
  leaderboardPublicCache.set(category, { expires: Date.now() + 30_000, value });
  try {
    return await value;
  } catch (error) {
    leaderboardPublicCache.delete(category);
    throw error;
  }
}

export async function leaderboards(url, viewer) {
  const category = url.pathname.split("/").pop();
  const allowed = new Set(["trending", "consistent", "followers", "new"]);
  if (!allowed.has(category))
    throw Object.assign(new Error("Unknown leaderboard category."), {
      status: 404,
    });
  const [board, graph] = await Promise.all([
    publishedBoard(category),
    pulseGraph(viewer),
  ]);
  const { snapshot } = board;
  if (!snapshot || snapshot.methodology_version !== PERFORMANCE_METHODOLOGY)
    return provisionalBoard(category, url, graph);
  const result = await pool.query(
    `SELECT lr.address,lr.rank,lr.metrics AS published_metrics,
  (SELECT COUNT(*) FROM follows f WHERE f.chain_id=$1 AND f.followed_address=lr.address) AS follower_count
  FROM leaderboard_rows lr
  WHERE lr.snapshot_id=$2 AND lr.eligible=true ORDER BY lr.rank LIMIT 100`,
    [config.chainId, snapshot.id],
  );
  const items = result.rows
    .filter((row) => !graph.blocked.has(row.address))
    .slice(0, boundedLimit(url, 12, 50))
    .map((row) => {
      const metrics = row.published_metrics || {};
      const cost = Number(metrics.realizedCostWei || 0);
      const pnl = Number(metrics.realizedPnlWei || 0);
      const tradeCount = Number(metrics.tradeCount || 0);
      return {
        address: row.address,
        rank: Number(row.rank),
        asOfBlock: String(snapshot.as_of_block),
        calculatedAt: snapshot.calculated_at,
        publishedAt: snapshot.published_at,
        methodologyVersion: snapshot.methodology_version,
        period: snapshot.period,
        publishedMetrics: metrics,
        followers: Number(row.follower_count || 0),
        isFollowed: graph.followed.has(row.address),
        recentVolumeWei: String(metrics.recentVolumeWei || 0),
        stats: {
          tradeCount,
          buyCount: Number(metrics.buyCount || 0),
          sellCount: Number(metrics.sellCount || 0),
          volumeWei: String(metrics.volumeWei || 0),
          realizedPnlWei: String(metrics.realizedPnlWei || 0),
          realizedCostWei: String(metrics.realizedCostWei || 0),
          realizedReturnPct: cost > 0 ? (pnl / cost) * 100 : null,
          marketsTraded: Number(metrics.marketCount || 0),
          firstTrade: metrics.firstTradeAt || null,
          lastTrade: metrics.lastTradeAt || null,
        },
        confidence:
          metrics.sampleLabel ||
          (tradeCount >= 25
            ? "established"
            : tradeCount >= 8
              ? "developing"
              : "new"),
      };
    });
  if (!items.length) return provisionalBoard(category, url, graph);
  return {
    category,
    period: snapshot.period,
    asOfBlock: String(snapshot.as_of_block),
    calculatedAt: snapshot.calculated_at,
    publishedAt: snapshot.published_at,
    methodologyVersion: snapshot.methodology_version,
    items,
  };
}

// Until a current-method snapshot has qualified traders, rank every trader by their latest stored
// performance. Marked provisional.
async function provisionalBoard(category, url, graph) {
  const result = await pool.query(provisionalLeaderboardSql, [
    config.chainId,
    100,
  ]);
  const items = result.rows
    .filter((row) => !graph.blocked.has(row.address))
    .slice(0, boundedLimit(url, 12, 50))
    .map((row, index) => ({
      address: row.address,
      rank: index + 1,
      methodologyVersion: row.methodology_version,
      publishedMetrics: {
        returnBps: row.return_bps == null ? null : Number(row.return_bps),
        investedWei: String(row.invested_quote),
        netPnlWei: (
          BigInt(row.realized_pnl_quote) + BigInt(row.unrealized_pnl_quote)
        ).toString(),
        tradeCount: Number(row.trade_count),
        marketCount: Number(row.market_count),
        sampleLabel: "provisional",
      },
      followers: 0,
      isFollowed: graph.followed.has(row.address),
      stats: {
        tradeCount: Number(row.trade_count),
        buyCount: 0,
        sellCount: 0,
        volumeWei: "0",
        realizedPnlWei: String(row.realized_pnl_quote),
        realizedCostWei: "0",
        realizedReturnPct: null,
        marketsTraded: Number(row.market_count),
        firstTrade: null,
        lastTrade: null,
      },
    }));
  return {
    category,
    period: null,
    asOfBlock: null,
    calculatedAt: null,
    publishedAt: null,
    methodologyVersion: null,
    provisional: true,
    items,
  };
}

export async function followingActivity(viewer) {
  if (!viewer)
    throw Object.assign(new Error("Sign in to see your follows."), {
      status: 401,
    });
  const graph = await pulseGraph(viewer);
  const followed = [...graph.followed];
  if (!followed.length)
    return { scope: "following", followedCount: 0, items: [] };
  const result = await pool.query(followingActivitySql, [
    config.chainId,
    followed,
    [...graph.blocked],
  ]);
  return {
    scope: "following",
    followedCount: followed.length,
    items: result.rows.map((row) => ({
      tokenAddress: row.token_address,
      tokenName: row.token_name,
      tokenSymbol: row.token_symbol,
      boughtQuoteWei: row.bought_quote_wei,
      soldQuoteWei: row.sold_quote_wei,
      latestAt: row.latest_at,
      actors: row.actors,
    })),
  };
}

export function invalidateLeaderboards() {
  leaderboardPublicCache.clear();
}

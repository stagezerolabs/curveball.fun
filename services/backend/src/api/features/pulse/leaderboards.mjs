import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { boundedLimit } from "../../transport/params.mjs";
import { pulseGraph } from "./pulse.mjs";
import { followingActivitySql } from "../../../analytics/pulseSql.mjs";
import {
  publishedSnapshotQuery,
  shapeLeaderboardResponse,
} from "./leaderboardResponse.mjs";

const leaderboardPublicCache = new Map();

// Latest published snapshot of the current methodology only; other versions are never served.
async function publishedBoard(category) {
  const cached = leaderboardPublicCache.get(category);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = (async () => {
    const query = publishedSnapshotQuery(config.chainId, category);
    const snapshotResult = await pool.query(query.text, query.values);
    const snapshot = snapshotResult.rows[0] || null;
    if (!snapshot || snapshot.status !== "ranked") return { snapshot, rows: [] };
    const rows = await pool.query(
      `SELECT lr.address,lr.rank,lr.metrics AS published_metrics,
        (SELECT COUNT(*) FROM follows f WHERE f.chain_id=$1 AND f.followed_address=lr.address) AS follower_count
      FROM leaderboard_rows lr
      WHERE lr.snapshot_id=$2 AND lr.eligible=true ORDER BY lr.rank LIMIT 100`,
      [config.chainId, snapshot.id],
    );
    return { snapshot, rows: rows.rows };
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
  return shapeLeaderboardResponse({
    category,
    snapshot: board.snapshot,
    rows: board.rows,
    graph,
    limit: boundedLimit(url, 12, 50),
    now: new Date(),
  });
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
      tokenSlug: row.token_slug,
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

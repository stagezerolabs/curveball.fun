import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { shapePublicPulseMoments } from "../../../analytics/pulse.mjs";
import { followingPulseSql, nowPulseSql } from "../../../analytics/pulseSql.mjs";

const pulseTradeCache = new Map();
const pulseGraphCache = new Map();
const pulseBlockedCache = new Map();

async function pulseTrades(
  period,
  followingViewer = null,
  blockedViewer = null,
  blockedAddresses = [],
) {
  const key = `${period}:${followingViewer || (blockedViewer ? `blocked:${blockedViewer}` : "public")}`;
  const current = pulseTradeCache.get(key);
  if (current && current.expires > Date.now()) return current.value;
  const interval = period === "1h" ? "1 hour" : "24 hours";
  const asOf = new Date();
  const bucketSeconds = period === "1h" ? 900 : 7200;
  const value = (
    followingViewer
      ? pool.query(followingPulseSql, [
          config.chainId,
          interval,
          followingViewer,
          bucketSeconds,
          asOf,
          blockedAddresses,
        ])
      : pool.query(nowPulseSql, [
          config.chainId,
          interval,
          asOf,
          blockedAddresses,
        ])
  ).then((result) => ({
    // SQL aggregates exact market totals and ranks candidates before transfer.
    items: shapePublicPulseMoments(result.rows, {
      scope: followingViewer ? "following" : "now",
    }),
    sampleTruncated: false,
    asOf: asOf.toISOString(),
    coveredFrom: new Date(
      asOf.getTime() - (period === "1h" ? 60 * 60_000 : 24 * 60 * 60_000),
    ).toISOString(),
  }));
  if (pulseTradeCache.size >= 500)
    pulseTradeCache.delete(pulseTradeCache.keys().next().value);
  const entry = { expires: Infinity, value };
  pulseTradeCache.set(key, entry);
  try {
    const result = await value;
    entry.expires =
      Date.now() + (followingViewer || blockedViewer ? 20_000 : 30_000);
    return result;
  } catch (error) {
    pulseTradeCache.delete(key);
    throw error;
  }
}

async function pulseBlockedAddresses(viewer) {
  if (!viewer) return new Set();
  const cached = pulseBlockedCache.get(viewer);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = pool
    .query(
      `SELECT CASE WHEN blocker_address=$2 THEN blocked_address ELSE blocker_address END AS address
    FROM blocks WHERE chain_id=$1 AND (blocker_address=$2 OR blocked_address=$2)`,
      [config.chainId, viewer],
    )
    .then((result) => new Set(result.rows.map((row) => row.address)));
  if (pulseBlockedCache.size >= 5_000)
    pulseBlockedCache.delete(pulseBlockedCache.keys().next().value);
  const entry = { expires: Infinity, value };
  pulseBlockedCache.set(viewer, entry);
  try {
    const result = await value;
    entry.expires = Date.now() + 60_000;
    return result;
  } catch (error) {
    pulseBlockedCache.delete(viewer);
    throw error;
  }
}

export async function pulseGraph(viewer) {
  if (!viewer) return { followed: new Set(), blocked: new Set() };
  const cached = pulseGraphCache.get(viewer);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = Promise.all([
    pool.query(
      "SELECT followed_address AS address FROM follows WHERE chain_id=$1 AND follower_address=$2",
      [config.chainId, viewer],
    ),
    pool.query(
      `SELECT CASE WHEN blocker_address=$2 THEN blocked_address ELSE blocker_address END AS address
      FROM blocks WHERE chain_id=$1 AND (blocker_address=$2 OR blocked_address=$2)`,
      [config.chainId, viewer],
    ),
  ]).then(([follows, blocks]) => ({
    followed: new Set(follows.rows.map((row) => row.address)),
    blocked: new Set(blocks.rows.map((row) => row.address)),
  }));
  if (pulseGraphCache.size >= 500)
    pulseGraphCache.delete(pulseGraphCache.keys().next().value);
  pulseGraphCache.set(viewer, { expires: Date.now() + 10_000, value });
  try {
    return await value;
  } catch (error) {
    pulseGraphCache.delete(viewer);
    throw error;
  }
}

export async function pulse(url, viewer) {
  const scope = url.searchParams.get("scope") || "now";
  const period = url.searchParams.get("period") || "1h";
  if (
    !["now", "following"].includes(scope) ||
    !["1h", "24h"].includes(period)
  ) {
    throw Object.assign(
      new Error("Choose a supported Pulse scope and period."),
      { status: 400 },
    );
  }
  if (scope === "following" && !viewer) {
    throw Object.assign(new Error("Sign in to view followed traders."), {
      status: 401,
    });
  }
  const blocked = await pulseBlockedAddresses(viewer);
  const trades =
    scope === "now"
      ? await pulseTrades(period, null, blocked.size ? viewer : null, [
          ...blocked,
        ])
      : await pulseTrades(period, viewer, null, [...blocked]);
  return {
    items: trades.items,
    asOf: trades.asOf,
    coveredFrom: trades.coveredFrom,
    sampleTruncated: trades.sampleTruncated,
  };
}


export function invalidateFollow(address) {
  pulseGraphCache.delete(address);
  pulseTradeCache.delete(`1h:${address}`);
  pulseTradeCache.delete(`24h:${address}`);
}

export function invalidateBlock(blocker, blocked) {
  pulseGraphCache.delete(blocker);
  pulseGraphCache.delete(blocked);
  pulseBlockedCache.delete(blocker);
  pulseBlockedCache.delete(blocked);
  for (const address of [blocker, blocked]) {
    pulseTradeCache.delete(`1h:blocked:${address}`);
    pulseTradeCache.delete(`24h:blocked:${address}`);
    pulseTradeCache.delete(`1h:${address}`);
    pulseTradeCache.delete(`24h:${address}`);
  }
}

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { PrivyClient } from "@privy-io/node";
import { getAddress, isAddress } from "viem";
import { config } from "./config.mjs";
import { pool, transaction } from "./db.mjs";
import {
  ACTIVE_WALLET_HEADER,
  createPrivyAuthenticator,
} from "./privyAuth.mjs";
import { claimProfile } from "./profiles.mjs";
import { shapePublicPulseMoments } from "./pulse.mjs";
import { PERFORMANCE_METHODOLOGY } from "./performance.mjs";
import {
  followingActivitySql,
  followingPulseSql,
  nowPulseSql,
  provisionalLeaderboardSql,
} from "./pulseSql.mjs";
import { captureBackendException } from "./instrument.mjs";
import { createOutboxHub } from "./outboxHub.mjs";

const JSON_LIMIT = 64 * 1024;
const RNS_CHAIN_ID = 4153;
const RNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.rise$/;
const privyClient = new PrivyClient({
  appId: config.privyAppId,
  appSecret: config.privyAppSecret,
});
const authenticatePrivyRequest = createPrivyAuthenticator({
  client: privyClient,
});
const requestAuthentication = new WeakMap();
// Process-local abuse guard for authenticated social writes. Multi-instance
// deployments also need a shared or edge rate limit to cover wallet/IP traffic.
const socialWriteBuckets = new Map();
let nextSocialWritePruneAt = 0;

function limitSocialWrite(request, address) {
  const now = Date.now();
  if (now >= nextSocialWritePruneAt) {
    for (const [key, bucket] of socialWriteBuckets) {
      if (bucket.expires <= now) socialWriteBuckets.delete(key);
    }
    nextSocialWritePruneAt = now + 10_000;
  }
  // Socket IP may be the ingress proxy for every viewer, so this is only a
  // coarse process safety ceiling. Wallet limits do the ordinary throttling.
  const limits = [
    [`wallet:${address}`, 30],
    [`ip:${request.socket.remoteAddress || "unknown"}`, 100_000],
  ];
  for (const [key, maximum] of limits) {
    const bucket = socialWriteBuckets.get(key);
    if (bucket && bucket.count >= maximum) {
      throw Object.assign(
        new Error("Too many social actions. Try again shortly."),
        {
          status: 429,
          retryAfter: Math.max(1, Math.ceil((bucket.expires - now) / 1_000)),
        },
      );
    }
  }
  for (const [key] of limits) {
    const bucket = socialWriteBuckets.get(key);
    if (bucket) bucket.count += 1;
    else socialWriteBuckets.set(key, { count: 1, expires: now + 60_000 });
  }
  if (socialWriteBuckets.size > 10_000)
    socialWriteBuckets.delete(socialWriteBuckets.keys().next().value);
}

// Process-local abuse guard for the unauthenticated RNS resolution path. It only counts lookups
// that miss the cache (the path that calls the upstream API); cached answers stay free. Socket IP
// may be an ingress proxy for every viewer, so like the write limiter this is a coarse process
// safety ceiling, not a substitute for an edge rate limit when the service is public.
const rnsLookupBuckets = new Map();
const RNS_LOOKUPS_PER_MINUTE = 120;
let nextRnsLookupPruneAt = 0;

function limitRnsLookup(remoteAddress) {
  const now = Date.now();
  if (now >= nextRnsLookupPruneAt) {
    for (const [key, bucket] of rnsLookupBuckets) {
      if (bucket.expires <= now) rnsLookupBuckets.delete(key);
    }
    nextRnsLookupPruneAt = now + 10_000;
  }
  const key = `ip:${remoteAddress || "unknown"}`;
  const bucket = rnsLookupBuckets.get(key);
  if (bucket && bucket.count >= RNS_LOOKUPS_PER_MINUTE) {
    throw Object.assign(
      new Error("Too many name lookups. Try again shortly."),
      {
        status: 429,
        retryAfter: Math.max(1, Math.ceil((bucket.expires - now) / 1_000)),
      },
    );
  }
  if (bucket) bucket.count += 1;
  else rnsLookupBuckets.set(key, { count: 1, expires: now + 60_000 });
  if (rnsLookupBuckets.size > 10_000)
    rnsLookupBuckets.delete(rnsLookupBuckets.keys().next().value);
}

function addressParam(value) {
  return typeof value === "string" && isAddress(value)
    ? getAddress(value).toLowerCase()
    : null;
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function send(request, response, status, body, extraHeaders = {}) {
  console.log(
    `${request.method} ${request.url} -> ${status} origin=${request.headers.origin || "-"}`,
  );
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(request),
    ...extraHeaders,
  });
  response.end(payload);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT)
      throw Object.assign(new Error("Request body is too large."), {
        status: 413,
      });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      status: 400,
    });
  }
}

function requireOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) {
    throw Object.assign(new Error("Request origin is not allowed."), {
      status: 403,
    });
  }
}

function authenticationFor(request) {
  let authentication = requestAuthentication.get(request);
  if (!authentication) {
    authentication = authenticatePrivyRequest(request);
    requestAuthentication.set(request, authentication);
  }
  return authentication;
}

async function viewerFor(request) {
  try {
    return (await authenticationFor(request))?.address || null;
  } catch {
    return null;
  }
}

async function requirePrivyWallet(request, checkOrigin = true) {
  if (checkOrigin) requireOrigin(request);
  const authentication = await authenticationFor(request);
  if (!authentication)
    throw Object.assign(new Error("Sign in with Privy to continue."), {
      status: 401,
    });
  return authentication.address;
}

async function requireModerator(request, checkOrigin = true) {
  const address = await requirePrivyWallet(request, checkOrigin);
  if (address !== config.adminAddress)
    throw Object.assign(new Error("Moderator access is required."), {
      status: 403,
    });
  return address;
}

function boundedLimit(url, fallback = 30, maximum = 100) {
  const value = Number(url.searchParams.get("limit") || fallback);
  return Number.isInteger(value)
    ? Math.min(maximum, Math.max(1, value))
    : fallback;
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch {
    throw Object.assign(new Error("The pagination cursor is invalid."), {
      status: 400,
    });
  }
}

function openEventStream(request, response, hub) {
  response.writeHead(200, {
    ...corsHeaders(request),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders?.();

  return hub.open(
    response,
    request.headers["last-event-id"],
    request.socket.remoteAddress,
  );
}

function shapeRns(address, primaryName, expiresAt) {
  return {
    chainId: RNS_CHAIN_ID,
    address,
    primaryName,
    isExpired: false,
    expiry: String(Math.floor(new Date(expiresAt).getTime() / 1_000)),
  };
}

async function resolveRns(address, remoteAddress) {
  const cached = await pool.query(
    `SELECT primary_name,status,expires_at FROM rns_cache
    WHERE chain_id=$1 AND address=$2 AND expires_at>now()`,
    [RNS_CHAIN_ID, address],
  );
  if (cached.rows[0])
    return shapeRns(
      address,
      cached.rows[0].status === "resolved" ? cached.rows[0].primary_name : null,
      cached.rows[0].expires_at,
    );
  limitRnsLookup(remoteAddress);

  let primaryName = null;
  let status = "not_found";
  let expiresAt = new Date(Date.now() + 10 * 60_000);
  try {
    const response = await fetch(
      `${config.rnsApiUrl}${address}?chainId=${RNS_CHAIN_ID}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.ok) {
      const payload = await response.json();
      const upstreamExpiry =
        typeof payload.expiry === "string" && /^\d+$/.test(payload.expiry)
          ? Number(payload.expiry)
          : 0;
      const valid =
        payload.chainId === RNS_CHAIN_ID &&
        typeof payload.address === "string" &&
        payload.address.toLowerCase() === address &&
        payload.isExpired === false &&
        typeof payload.primaryName === "string" &&
        RNS_NAME.test(payload.primaryName) &&
        upstreamExpiry * 1_000 > Date.now();
      if (valid) {
        primaryName = payload.primaryName;
        status = "resolved";
        expiresAt = new Date(
          Math.min(upstreamExpiry * 1_000, Date.now() + 60 * 60_000),
        );
      }
    } else if (response.status !== 404) {
      throw new Error(`RNS request failed (${response.status}).`);
    }
  } catch {
    status = "error";
    expiresAt = new Date(Date.now() + 2 * 60_000);
  }
  await pool.query(
    `INSERT INTO rns_cache (chain_id,address,primary_name,status,resolved_at,expires_at)
    VALUES ($1,$2,$3,$4,now(),$5) ON CONFLICT (chain_id,address) DO UPDATE SET
    primary_name=EXCLUDED.primary_name,status=EXCLUDED.status,resolved_at=now(),expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [RNS_CHAIN_ID, address, primaryName, status, expiresAt],
  );
  return shapeRns(address, primaryName, expiresAt);
}

const statsSql = `
  WITH activity AS (
    SELECT t.trader_address,
      COUNT(*) AS trade_count,
      COUNT(*) FILTER (WHERE t.is_buy) AS buy_count,
      COUNT(*) FILTER (WHERE NOT t.is_buy) AS sell_count,
      SUM(t.net_trader_quote) AS volume_wei,
      COUNT(DISTINCT t.token_address) AS markets_traded,
      MIN(t.block_timestamp) AS first_trade,
      MAX(t.block_timestamp) AS last_trade
    FROM trades t WHERE t.chain_id = $1 AND t.orphaned = false
      AND NOT EXISTS (
        SELECT 1 FROM protocol_accounts pa
        WHERE pa.chain_id=t.chain_id AND pa.address=t.trader_address AND pa.is_user_attributable=false
      )
    GROUP BY t.trader_address
  ), performance AS (
    SELECT trader_address,
      SUM(realized_pnl_quote) AS realized_pnl_wei,
      SUM(realized_cost_basis_quote) AS realized_cost_wei
    FROM curve_positions WHERE chain_id=$1 GROUP BY trader_address
  ), wallet AS (
    SELECT a.*,COALESCE(p.realized_pnl_wei,0) AS realized_pnl_wei,
      COALESCE(p.realized_cost_wei,0) AS realized_cost_wei
    FROM activity a LEFT JOIN performance p USING (trader_address)
  )
`;

function shapeStats(row) {
  if (!row)
    return {
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      volumeWei: "0",
      realizedPnlWei: "0",
      realizedReturnPct: null,
      marketsTraded: 0,
      firstTrade: null,
      lastTrade: null,
    };
  const cost = Number(row.realized_cost_wei || 0);
  const pnl = Number(row.realized_pnl_wei || 0);
  return {
    tradeCount: Number(row.trade_count || 0),
    buyCount: Number(row.buy_count || 0),
    sellCount: Number(row.sell_count || 0),
    volumeWei: String(row.volume_wei || 0),
    realizedPnlWei: String(row.realized_pnl_wei || 0),
    realizedReturnPct: cost > 0 ? (pnl / cost) * 100 : null,
    marketsTraded: Number(row.markets_traded || 0),
    firstTrade: row.first_trade,
    lastTrade: row.last_trade,
  };
}

async function feed(url, viewer) {
  const limit = boundedLimit(url);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const legacyBefore = url.searchParams.get("before");
  const beforeAt = typeof cursor?.at === "string" ? cursor.at : legacyBefore;
  const beforeId = typeof cursor?.id === "string" ? cursor.id : null;
  const scope = url.searchParams.get("scope") || "global";
  const trader = url.searchParams.get("trader")
    ? addressParam(url.searchParams.get("trader"))
    : null;
  if (scope === "following" && !viewer)
    throw Object.assign(new Error("Sign in to view followed traders."), {
      status: 401,
    });
  const values = [
    config.chainId,
    limit,
    beforeAt || null,
    viewer || null,
    scope,
    trader,
    beforeId,
  ];
  const result = await pool.query(
    `SELECT t.logical_id AS id, t.trader_address, t.is_buy, t.net_trader_quote AS quote_amount_wei,
       t.token_amount AS token_amount_wei, t.virtual_quote_after, t.virtual_token_after,
       t.transaction_hash, t.log_index, t.block_timestamp, m.token_address, m.name AS token_name,
       m.symbol AS token_symbol, m.launchpad_address, n.note,
       (SELECT COUNT(*) FROM trade_reactions rx WHERE rx.logical_trade_id=t.logical_id) AS reaction_count,
       EXISTS(SELECT 1 FROM trade_reactions rx WHERE rx.logical_trade_id=t.logical_id AND rx.reactor_address=$4) AS reacted,
       EXISTS(SELECT 1 FROM follows fv WHERE fv.chain_id=t.chain_id AND fv.follower_address=$4 AND fv.followed_address=t.trader_address) AS is_followed,
       (SELECT COUNT(*) FROM follows f2 WHERE f2.chain_id = t.chain_id AND f2.followed_address = t.trader_address) AS follower_count
     FROM trades t
     JOIN markets m ON m.chain_id = t.chain_id AND m.token_address = t.token_address AND m.orphaned = false
     LEFT JOIN trade_notes n ON n.logical_trade_id = t.logical_id AND NOT EXISTS (
       SELECT 1 FROM reports r
       WHERE r.chain_id=t.chain_id AND r.subject_trade_id=t.logical_id AND r.status='actioned'
     )
     WHERE t.chain_id = $1 AND t.orphaned = false
       AND ($3::timestamptz IS NULL OR t.block_timestamp < $3::timestamptz
         OR (t.block_timestamp=$3::timestamptz AND $7::text IS NOT NULL AND t.logical_id < $7))
       AND ($4::text IS NULL OR $5::text <> 'following' OR EXISTS (
         SELECT 1 FROM follows f WHERE f.chain_id = t.chain_id AND f.follower_address = $4 AND f.followed_address = t.trader_address
       ))
       AND ($6::text IS NULL OR t.trader_address = $6)
       AND ($4::text IS NULL OR NOT EXISTS (
         SELECT 1 FROM blocks b WHERE b.chain_id=t.chain_id AND (
           (b.blocker_address=$4 AND b.blocked_address=t.trader_address)
           OR (b.blocker_address=t.trader_address AND b.blocked_address=$4)
         )
       ))
     ORDER BY t.block_timestamp DESC, t.logical_id DESC LIMIT $2`,
    values,
  );
  const last = result.rows.at(-1);
  return {
    items: result.rows,
    nextCursor:
      last && result.rows.length === limit
        ? encodeCursor({ at: last.block_timestamp, id: last.id })
        : null,
  };
}

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

async function pulseGraph(viewer) {
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

async function pulse(url, viewer) {
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

async function profile(address, viewer) {
  const [profileResult, statsResult, countsResult, positionsResult] =
    await Promise.all([
      pool.query(
        "SELECT claimed_at, updated_at FROM profiles WHERE chain_id = $1 AND address = $2",
        [config.chainId, address],
      ),
      pool.query(`${statsSql} SELECT * FROM wallet WHERE trader_address = $2`, [
        config.chainId,
        address,
      ]),
      pool.query(
        `SELECT
      (SELECT COUNT(*) FROM follows WHERE chain_id = $1 AND followed_address = $2) AS followers,
      (SELECT COUNT(*) FROM follows WHERE chain_id = $1 AND follower_address = $2) AS following,
      EXISTS(SELECT 1 FROM follows WHERE chain_id = $1 AND follower_address = $3 AND followed_address = $2) AS is_followed,
      EXISTS(SELECT 1 FROM blocks WHERE chain_id = $1 AND blocker_address = $3 AND blocked_address = $2) AS is_blocked`,
        [config.chainId, address, viewer || ""],
      ),
      pool.query(
        `WITH transfer_balances AS (
        SELECT token_address,SUM(CASE WHEN to_address=$2 THEN amount ELSE 0 END)-SUM(CASE WHEN from_address=$2 THEN amount ELSE 0 END) AS balance
        FROM asset_transfers WHERE chain_id=$1 AND orphaned=false AND (to_address=$2 OR from_address=$2) GROUP BY token_address
      ), position_tokens AS (
        SELECT token_address FROM curve_positions WHERE chain_id=$1 AND trader_address=$2
        UNION SELECT token_address FROM transfer_balances WHERE balance>0
      ) SELECT pt.token_address,m.name AS token_name,m.symbol AS token_symbol,
        COALESCE(tb.balance,cp.known_basis_token_balance,0) AS balance_wei,
        COALESCE(cp.known_basis_token_balance,0) AS known_basis_balance_wei,
        (tb.token_address IS NOT NULL) AS exact_balance_indexed,
        COALESCE(cp.total_invested_quote,0) AS invested_wei,COALESCE(cp.total_proceeds_quote,0) AS proceeds_wei,
        ms.virtual_quote AS virtual_quote_after,ms.virtual_token AS virtual_token_after
      FROM position_tokens pt JOIN markets m ON m.chain_id=$1 AND m.token_address=pt.token_address
      LEFT JOIN transfer_balances tb ON tb.token_address=pt.token_address
      LEFT JOIN curve_positions cp ON cp.chain_id=$1 AND cp.trader_address=$2 AND cp.token_address=pt.token_address
      JOIN market_stats ms ON ms.chain_id=$1 AND ms.token_address=pt.token_address
      WHERE COALESCE(tb.balance,cp.known_basis_token_balance,0)>0
      ORDER BY COALESCE(cp.total_invested_quote,0) DESC LIMIT 20`,
        [config.chainId, address],
      ),
    ]);
  const claimed = profileResult.rows[0] || null;
  return {
    address,
    claimed: Boolean(claimed),
    claimedAt: claimed?.claimed_at || null,
    stats: shapeStats(statsResult.rows[0]),
    followers: Number(countsResult.rows[0]?.followers || 0),
    following: Number(countsResult.rows[0]?.following || 0),
    isFollowed: Boolean(countsResult.rows[0]?.is_followed),
    isBlocked: Boolean(countsResult.rows[0]?.is_blocked),
    positions: positionsResult.rows,
  };
}

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

async function leaderboards(url, viewer) {
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

async function followingActivity(viewer) {
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

function shapeMarket(row) {
  return {
    chainId: Number(row.chain_id),
    factoryAddress: config.launchpadAddress.toLowerCase(),
    tokenAddress: row.token_address,
    launchpadAddress: row.launchpad_address,
    creatorAddress: row.creator_address,
    name: row.name,
    symbol: row.symbol,
    metadataUri: row.metadata_uri,
    imageUrl: row.token_metadata?.imageUrl || null,
    state: row.state,
    readyAt: row.ready_at,
    isGraduated: Boolean(row.graduated),
    poolAddress: row.pool_address,
    launchedAt: row.launched_at,
    launchBlock: String(row.launch_block),
    policy: {
      totalSupply: row.total_supply,
      curveSupply: row.curve_supply,
      reserveAmount: row.reserve_amount,
      reserveBps: row.reserve_bps === null ? null : Number(row.reserve_bps),
      initialVirtualQuote: row.initial_virtual_quote,
      graduationTargetQuote: row.graduation_target_quote,
      feeBps: row.fee_bps === null ? null : Number(row.fee_bps),
      creatorFeeShareBps:
        row.creator_fee_share_bps === null
          ? null
          : Number(row.creator_fee_share_bps),
      buybackFeeShareBps:
        row.buyback_fee_share_bps === null
          ? null
          : Number(row.buyback_fee_share_bps),
      creatorTaxBps:
        row.creator_tax_bps === null ? null : Number(row.creator_tax_bps),
    },
    metrics: {
      tradeCount: Number(row.trade_count || 0),
      uniqueTraderCount: Number(row.unique_trader_count || 0),
      grossQuoteVolume: String(row.gross_quote_volume || 0),
      walletCashTurnover: String(row.wallet_cash_turnover || 0),
      virtualQuote:
        row.virtual_quote === null ? null : String(row.virtual_quote),
      virtualToken:
        row.virtual_token === null ? null : String(row.virtual_token),
      sold: row.sold === null ? "0" : String(row.sold),
      currentPriceX18:
        row.current_price_x18 === null ? null : String(row.current_price_x18),
      athPriceX18:
        row.ath_price_x18 === null ? null : String(row.ath_price_x18),
      recentGrossQuoteVolume: String(row.recent_gross_quote_volume || 0),
      change1hBps:
        row.change_1h_bps === null ? null : Number(row.change_1h_bps),
      change6hBps:
        row.change_6h_bps === null ? null : Number(row.change_6h_bps),
      change24hBps:
        row.change_24h_bps === null ? null : Number(row.change_24h_bps),
      latestTradeAt: row.latest_trade_at,
    },
  };
}

const recentVolumeExpression = "COALESCE(ms.gross_quote_volume_24h,0)";

const marketSelect = `SELECT m.*,ms.trade_count,ms.unique_trader_count,ms.gross_quote_volume,
  ms.wallet_cash_turnover,ms.virtual_quote,ms.virtual_token,ms.sold,ms.latest_trade_at,
  ms.current_price_x18,ms.ath_price_x18,ms.change_1h_bps,ms.change_6h_bps,ms.change_24h_bps,
  a.metadata AS token_metadata,
  ${recentVolumeExpression} AS recent_gross_quote_volume`;

async function markets(url) {
  const limit = boundedLimit(url, 24, 50);
  const tab = url.searchParams.get("tab") || "trending";
  if (!new Set(["trending", "new", "graduated", "all"]).has(tab)) {
    throw Object.assign(new Error("Unknown market tab."), { status: 400 });
  }
  const search = (url.searchParams.get("search") || "").trim().slice(0, 80);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (cursor && cursor.tab !== tab)
    throw Object.assign(
      new Error("The market cursor belongs to another tab."),
      { status: 400 },
    );
  const cursorValue = typeof cursor?.value === "string" ? cursor.value : null;
  const cursorToken =
    typeof cursor?.token === "string" ? addressParam(cursor.token) : null;
  const statusClause =
    tab === "graduated"
      ? "AND m.graduated=true"
      : tab === "all"
        ? ""
        : "AND m.graduated=false";
  const orderExpression =
    tab === "trending" ? "recent_gross_quote_volume" : "m.launched_at";
  const cursorClause =
    tab === "trending"
      ? `AND ($4::numeric IS NULL OR (${recentVolumeExpression},m.token_address)<($4::numeric,$5::text))`
      : "AND ($4::timestamptz IS NULL OR (m.launched_at,m.token_address)<($4::timestamptz,$5::text))";
  const result = await pool.query(
    `${marketSelect}
    FROM markets m LEFT JOIN market_stats ms ON ms.chain_id=m.chain_id AND ms.token_address=m.token_address
    LEFT JOIN assets a ON a.chain_id=m.chain_id AND a.address=m.token_address
    WHERE m.chain_id=$1 AND m.orphaned=false ${statusClause}
      AND ($3::text='' OR m.name ILIKE '%'||$3||'%' OR m.symbol ILIKE '%'||$3||'%')
      ${cursorClause}
    ORDER BY ${orderExpression} DESC,m.token_address DESC LIMIT $2`,
    [config.chainId, limit + 1, search, cursorValue, cursorToken],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  return {
    items: rows.map(shapeMarket),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            tab,
            value:
              tab === "trending"
                ? String(last.recent_gross_quote_volume || 0)
                : new Date(last.launched_at).toISOString(),
            token: last.token_address,
          })
        : null,
  };
}

async function market(address) {
  const result = await pool.query(
    `${marketSelect}
    FROM markets m LEFT JOIN market_stats ms ON ms.chain_id=m.chain_id AND ms.token_address=m.token_address
    LEFT JOIN assets a ON a.chain_id=m.chain_id AND a.address=m.token_address
    WHERE m.chain_id=$1 AND m.token_address=$2 AND m.orphaned=false`,
    [config.chainId, address],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Market not found."), { status: 404 });
  return shapeMarket(result.rows[0]);
}

async function marketTrades(url, tokenAddress, viewer) {
  const limit = boundedLimit(url, 50, 100);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const beforeAt = typeof cursor?.at === "string" ? cursor.at : null;
  const beforeId = typeof cursor?.id === "string" ? cursor.id : null;
  const graph = await pulseGraph(viewer);
  const followed = [...graph.followed];
  const blocked = [...graph.blocked];
  const [result, followedHere] = await Promise.all([
    pool.query(
      `WITH activity AS (
      SELECT logical_id,trader_address AS participant_address,'trader'::text AS participant_role,
        NULL::text AS execution_sender_address,'curve'::text AS venue_type,launchpad_address AS venue_address,
        is_buy,gross_curve_quote,net_trader_quote,fee_quote,creator_tax_quote,token_amount,
        virtual_quote_after,virtual_token_after,sold_after,transaction_hash,block_number,log_index,block_timestamp
      FROM trades WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
      UNION ALL
      SELECT logical_id,recipient_address,'recipient',sender_address,'pool',pool_address,is_buy,
        quote_amount,quote_amount,0,0,token_amount,NULL,NULL,NULL,transaction_hash,block_number,log_index,block_timestamp
      FROM venue_swaps WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
    ) SELECT a.*,n.note,
      (SELECT COUNT(*) FROM trade_reactions rx WHERE rx.logical_trade_id=a.logical_id) AS reaction_count,
      EXISTS(SELECT 1 FROM trade_reactions rx WHERE rx.logical_trade_id=a.logical_id AND rx.reactor_address=$6) AS reacted,
      (a.participant_address=ANY($7::text[])) AS is_followed,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.chain_id=$1 AND f2.followed_address=a.participant_address) AS follower_count
    FROM activity a
    LEFT JOIN trade_notes n ON n.logical_trade_id=a.logical_id AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.chain_id=$1 AND r.subject_trade_id=a.logical_id AND r.status='actioned'
    )
    WHERE true
      AND ($4::timestamptz IS NULL OR block_timestamp<$4::timestamptz
        OR (block_timestamp=$4::timestamptz AND $5::text IS NOT NULL AND logical_id<$5))
      AND NOT (a.participant_address=ANY($8::text[]))
    ORDER BY block_timestamp DESC,logical_id DESC LIMIT $3`,
      [
        config.chainId,
        tokenAddress,
        limit,
        beforeAt,
        beforeId,
        viewer || "",
        followed,
        blocked,
      ],
    ),
    followed.length
      ? pool.query(
          `SELECT COUNT(*) AS traders FROM (
          SELECT trader_address AS participant FROM trades WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
          UNION SELECT recipient_address FROM venue_swaps WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
        ) actors WHERE actors.participant=ANY($3::text[])`,
          [config.chainId, tokenAddress, followed],
        )
      : Promise.resolve({ rows: [{ traders: 0 }] }),
  ]);
  const items = result.rows.map((row) => ({
    id: row.logical_id,
    participantAddress: row.participant_address,
    participantRole: row.participant_role,
    executionSenderAddress: row.execution_sender_address,
    venueType: row.venue_type,
    venueAddress: row.venue_address,
    side: row.is_buy ? "buy" : "sell",
    grossCurveQuote: String(row.gross_curve_quote),
    walletQuoteAmount: String(row.net_trader_quote),
    feeQuote: String(row.fee_quote),
    creatorTaxQuote: String(row.creator_tax_quote),
    tokenAmount: String(row.token_amount),
    virtualQuoteAfter:
      row.virtual_quote_after === null ? null : String(row.virtual_quote_after),
    virtualTokenAfter:
      row.virtual_token_after === null ? null : String(row.virtual_token_after),
    soldAfter: row.sold_after === null ? null : String(row.sold_after),
    transactionHash: row.transaction_hash,
    blockNumber: String(row.block_number),
    logIndex: Number(row.log_index),
    blockTimestamp: row.block_timestamp,
    note: row.note || null,
    reactionCount: Number(row.reaction_count || 0),
    reacted: Boolean(row.reacted),
    isFollowed: Boolean(row.is_followed),
    followerCount: Number(row.follower_count || 0),
  }));
  const last = result.rows.at(-1);
  return {
    followingTraderCount: Number(followedHere.rows[0]?.traders || 0),
    items,
    nextCursor: last
      ? encodeCursor({ at: last.block_timestamp, id: last.logical_id })
      : null,
  };
}

async function marketCandles(url, tokenAddress) {
  const interval = Number(url.searchParams.get("interval") || 300);
  if (![60, 300, 900, 3_600, 14_400, 86_400].includes(interval)) {
    throw Object.assign(new Error("Unsupported candle interval."), {
      status: 400,
    });
  }
  const from = url.searchParams.get("from");
  const limit = boundedLimit(url, 500, 2_000);
  const result = await pool.query(
    `SELECT bucket_start,open_price_x18,high_price_x18,low_price_x18,close_price_x18,
      gross_quote_volume,wallet_cash_turnover,token_volume,trade_count,buy_count,sell_count
    FROM market_candles WHERE chain_id=$1 AND token_address=$2 AND interval_seconds=$3
      AND ($4::timestamptz IS NULL OR bucket_start>=$4::timestamptz)
    ORDER BY bucket_start DESC LIMIT $5`,
    [config.chainId, tokenAddress, interval, from, limit],
  );
  return {
    intervalSeconds: interval,
    items: result.rows.reverse().map((row) => ({
      bucketStart: row.bucket_start,
      openPriceX18: String(row.open_price_x18),
      highPriceX18: String(row.high_price_x18),
      lowPriceX18: String(row.low_price_x18),
      closePriceX18: String(row.close_price_x18),
      grossQuoteVolume: String(row.gross_quote_volume),
      walletCashTurnover: String(row.wallet_cash_turnover),
      tokenVolume: String(row.token_volume),
      tradeCount: Number(row.trade_count),
      buyCount: Number(row.buy_count),
      sellCount: Number(row.sell_count),
    })),
  };
}

async function marketHolders(url, tokenAddress, viewer) {
  const atBlockValue = url.searchParams.get("atBlock");
  const atBlock =
    atBlockValue && /^\d+$/.test(atBlockValue) ? atBlockValue : null;
  const limit = boundedLimit(url, 100, 500);
  const graph = await pulseGraph(viewer);
  const followed = [...graph.followed];
  const result = await pool.query(
    `WITH balances AS (
      SELECT wallet,SUM(delta) AS balance FROM (
        SELECT to_address AS wallet,amount AS delta FROM asset_transfers
          WHERE chain_id=$1 AND token_address=$2 AND orphaned=false AND ($3::numeric IS NULL OR block_number<=$3)
        UNION ALL
        SELECT from_address AS wallet,-amount AS delta FROM asset_transfers
          WHERE chain_id=$1 AND token_address=$2 AND orphaned=false AND ($3::numeric IS NULL OR block_number<=$3)
      ) movements WHERE wallet<>'0x0000000000000000000000000000000000000000' GROUP BY wallet
    ), eligible AS (
      SELECT wallet,balance FROM balances b WHERE balance>0 AND NOT EXISTS (
        SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=$1 AND pa.address=b.wallet AND pa.is_user_attributable=false
      )
    ) SELECT wallet AS address,balance,(wallet=ANY($5::text[])) AS is_followed,
      SUM(balance) OVER () AS eligible_supply,
      COUNT(*) FILTER (WHERE wallet=ANY($5::text[])) OVER () AS followed_count
    FROM eligible ORDER BY balance DESC,wallet ASC LIMIT $4`,
    [config.chainId, tokenAddress, atBlock, limit, followed],
  );
  return {
    atBlock,
    eligibleSupply: String(result.rows[0]?.eligible_supply || 0),
    followedHolderCount: Number(result.rows[0]?.followed_count || 0),
    items: result.rows.map((row) => ({
      address: row.address,
      balance: String(row.balance),
      isFollowed: Boolean(row.is_followed),
    })),
  };
}

async function protocolStats() {
  const result = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE orphaned=false) AS markets,
      COUNT(*) FILTER (WHERE orphaned=false AND graduated=true) AS graduated,
      COALESCE((SELECT SUM(gross_curve_quote) FROM trades WHERE chain_id=$1 AND orphaned=false),0) AS gross_quote_volume,
      COALESCE((SELECT SUM(net_trader_quote) FROM trades WHERE chain_id=$1 AND orphaned=false),0) AS wallet_cash_turnover,
      (SELECT COUNT(DISTINCT trader_address) FROM trades t WHERE chain_id=$1 AND orphaned=false AND NOT EXISTS (
        SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=t.chain_id AND pa.address=t.trader_address AND pa.is_user_attributable=false
      )) AS traders,
      COALESCE((SELECT SUM((pf.metadata->>'creatorAmount')::numeric) FROM protocol_flows pf WHERE pf.chain_id=$1 AND pf.orphaned=false
        AND pf.category='fee_accrued' AND pf.asset_address=(SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1)),0) AS creator_fees_earned,
      COALESCE((SELECT SUM(amount) FROM protocol_flows pf WHERE pf.chain_id=$1 AND pf.orphaned=false
        AND pf.category='fee_claimed' AND pf.asset_address=(SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1)
        AND EXISTS (SELECT 1 FROM markets cm WHERE cm.chain_id=pf.chain_id AND cm.orphaned=false AND cm.creator_address=pf.to_address)),0) AS creator_fees_claimed,
      COALESCE((SELECT SUM(quote_spent) FROM buyback_executions WHERE chain_id=$1 AND orphaned=false),0) AS buyback_quote_spent,
      COALESCE((SELECT SUM(amount) FROM protocol_flows pf WHERE pf.chain_id=$1 AND pf.orphaned=false AND pf.category='pool_fee'
        AND pf.asset_address=(SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1)),0) AS pool_quote_fees
    FROM markets WHERE chain_id=$1`,
    [config.chainId],
  );
  const row = result.rows[0];
  return {
    markets: Number(row.markets || 0),
    graduated: Number(row.graduated || 0),
    grossQuoteVolume: String(row.gross_quote_volume || 0),
    walletCashTurnover: String(row.wallet_cash_turnover || 0),
    traders: Number(row.traders || 0),
    creatorFeesEarned: String(row.creator_fees_earned || 0),
    creatorFeesClaimed: String(row.creator_fees_claimed || 0),
    buybackQuoteSpent: String(row.buyback_quote_spent || 0),
    poolQuoteFees: String(row.pool_quote_fees || 0),
  };
}

export function createSocialServer({ subscribe } = {}) {
  const eventHub = createOutboxHub({
    query: (...args) => pool.query(...args),
    subscribe,
  });
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", config.publicOrigin);
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          ...corsHeaders(request),
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": `Content-Type, Authorization, ${ACTIVE_WALLET_HEADER}`,
        });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const result = await pool.query(
          "SELECT stream, next_block, updated_at FROM chain_cursors WHERE chain_id=$1",
          [config.chainId],
        );
        return send(request, response, 200, {
          ok: true,
          chainId: config.chainId,
          cursors: result.rows,
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/events") {
        await openEventStream(request, response, eventHub);
        return;
      }

      const viewer = await viewerFor(request);
      const rnsMatch = url.pathname.match(
        /^\/v1\/rns\/primary\/(0x[a-fA-F0-9]{40})$/,
      );
      if (request.method === "GET" && rnsMatch) {
        const address = addressParam(rnsMatch[1]);
        return send(
          request,
          response,
          200,
          await resolveRns(address, request.socket.remoteAddress),
        );
      }
      if (request.method === "GET" && url.pathname === "/v1/me")
        return send(request, response, 200, { address: viewer });
      if (request.method === "POST" && url.pathname === "/v1/me") {
        const address = await requirePrivyWallet(request);
        await claimProfile(pool, config.chainId, address);
        return send(request, response, 200, { address });
      }
      if (request.method === "GET" && url.pathname === "/v1/feed")
        return send(request, response, 200, await feed(url, viewer));
      if (request.method === "GET" && url.pathname === "/v1/pulse")
        return send(request, response, 200, await pulse(url, viewer));
      if (request.method === "GET" && url.pathname === "/v1/following/activity")
        return send(request, response, 200, await followingActivity(viewer));
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/v1/leaderboards/")
      )
        return send(request, response, 200, await leaderboards(url, viewer));
      if (request.method === "GET" && url.pathname === "/v1/markets")
        return send(request, response, 200, await markets(url));
      if (request.method === "GET" && url.pathname === "/v1/protocol/stats")
        return send(request, response, 200, await protocolStats());

      const marketTradesMatch = url.pathname.match(
        /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/trades$/,
      );
      if (request.method === "GET" && marketTradesMatch) {
        return send(
          request,
          response,
          200,
          await marketTrades(url, addressParam(marketTradesMatch[1]), viewer),
        );
      }
      const marketCandlesMatch = url.pathname.match(
        /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/candles$/,
      );
      if (request.method === "GET" && marketCandlesMatch) {
        return send(
          request,
          response,
          200,
          await marketCandles(url, addressParam(marketCandlesMatch[1])),
        );
      }
      const marketHoldersMatch = url.pathname.match(
        /^\/v1\/markets\/(0x[a-fA-F0-9]{40})\/holders$/,
      );
      if (request.method === "GET" && marketHoldersMatch) {
        return send(
          request,
          response,
          200,
          await marketHolders(url, addressParam(marketHoldersMatch[1]), viewer),
        );
      }
      const marketMatch = url.pathname.match(
        /^\/v1\/markets\/(0x[a-fA-F0-9]{40})$/,
      );
      if (request.method === "GET" && marketMatch) {
        return send(
          request,
          response,
          200,
          await market(addressParam(marketMatch[1])),
        );
      }

      const profileMatch = url.pathname.match(
        /^\/v1\/profiles\/(0x[a-fA-F0-9]{40})$/,
      );
      if (request.method === "GET" && profileMatch) {
        const address = addressParam(profileMatch[1]);
        return send(request, response, 200, await profile(address, viewer));
      }

      const followMatch = url.pathname.match(
        /^\/v1\/follows\/(0x[a-fA-F0-9]{40})$/,
      );
      if (followMatch && ["POST", "DELETE"].includes(request.method)) {
        const follower = await requirePrivyWallet(request);
        limitSocialWrite(request, follower);
        const followed = addressParam(followMatch[1]);
        if (!followed || followed === follower)
          throw Object.assign(new Error("Choose another trader to follow."), {
            status: 400,
          });
        if (request.method === "POST") {
          await transaction(async (db) => {
            const blocked = await db.query(
              `SELECT 1 FROM blocks WHERE chain_id=$1 AND (
              (blocker_address=$2 AND blocked_address=$3) OR (blocker_address=$3 AND blocked_address=$2)
            )`,
              [config.chainId, follower, followed],
            );
            if (blocked.rowCount)
              throw Object.assign(
                new Error(
                  "This follow is unavailable because one wallet has blocked the other.",
                ),
                { status: 409 },
              );
            const inserted = await db.query(
              "INSERT INTO follows (chain_id,follower_address,followed_address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING followed_address",
              [config.chainId, follower, followed],
            );
            if (inserted.rowCount) {
              await db.query(
                `INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
                SELECT $1,$2,'new_follower',$3,$4,'{}'
                WHERE COALESCE((SELECT in_app AND new_followers FROM notification_preferences WHERE chain_id=$1 AND address=$2),true)`,
                [config.chainId, followed, follower, randomUUID()],
              );
            }
          });
        } else {
          await pool.query(
            "DELETE FROM follows WHERE chain_id=$1 AND follower_address=$2 AND followed_address=$3",
            [config.chainId, follower, followed],
          );
        }
        pulseGraphCache.delete(follower);
        pulseTradeCache.delete(`1h:${follower}`);
        pulseTradeCache.delete(`24h:${follower}`);
        leaderboardPublicCache.clear();
        return send(request, response, 200, {
          following: request.method === "POST",
        });
      }

      const blockMatch = url.pathname.match(
        /^\/v1\/blocks\/(0x[a-fA-F0-9]{40})$/,
      );
      if (blockMatch && ["POST", "DELETE"].includes(request.method)) {
        const blocker = await requirePrivyWallet(request);
        limitSocialWrite(request, blocker);
        const blocked = addressParam(blockMatch[1]);
        if (!blocked || blocked === blocker)
          throw Object.assign(new Error("Choose another trader to block."), {
            status: 400,
          });
        if (request.method === "POST") {
          await transaction(async (db) => {
            await db.query(
              "INSERT INTO blocks (chain_id,blocker_address,blocked_address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
              [config.chainId, blocker, blocked],
            );
            await db.query(
              `DELETE FROM follows WHERE chain_id=$1 AND (
              (follower_address=$2 AND followed_address=$3) OR (follower_address=$3 AND followed_address=$2)
            )`,
              [config.chainId, blocker, blocked],
            );
          });
        } else {
          await pool.query(
            "DELETE FROM blocks WHERE chain_id=$1 AND blocker_address=$2 AND blocked_address=$3",
            [config.chainId, blocker, blocked],
          );
        }
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
        return send(request, response, 200, {
          blocked: request.method === "POST",
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/reports") {
        const reporter = await requirePrivyWallet(request);
        limitSocialWrite(request, reporter);
        const body = await readJson(request);
        const subject = addressParam(body.subjectAddress);
        const allowed = new Set([
          "spam",
          "impersonation",
          "manipulation",
          "harmful_content",
          "other",
        ]);
        const tradeId =
          body.tradeId == null
            ? null
            : typeof body.tradeId === "string" && body.tradeId.length <= 256
              ? body.tradeId
              : "";
        if (
          !subject ||
          subject === reporter ||
          !allowed.has(body.reason) ||
          (body.tradeId != null && !tradeId)
        ) {
          throw Object.assign(new Error("Choose a valid report reason."), {
            status: 400,
          });
        }
        if (tradeId) {
          const trade = await pool.query(
            "SELECT trader_address FROM trades WHERE logical_id=$1 AND chain_id=$2 AND orphaned=false",
            [tradeId, config.chainId],
          );
          if (!trade.rows[0] || trade.rows[0].trader_address !== subject) {
            throw Object.assign(
              new Error("The reported trade does not belong to that wallet."),
              { status: 400 },
            );
          }
        }
        await pool.query(
          "INSERT INTO reports (chain_id,reporter_address,subject_address,subject_trade_id,reason,details) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            config.chainId,
            reporter,
            subject,
            tradeId,
            body.reason,
            typeof body.details === "string" ? body.details.slice(0, 1000) : "",
          ],
        );
        return send(request, response, 201, { ok: true });
      }

      if (request.method === "POST" && url.pathname === "/v1/trade-notes") {
        const author = await requirePrivyWallet(request);
        limitSocialWrite(request, author);
        const body = await readJson(request);
        const tradeId = typeof body.tradeId === "string" ? body.tradeId : "";
        const note =
          typeof body.note === "string" ? body.note.trim().slice(0, 240) : "";
        const trade = await pool.query(
          "SELECT trader_address FROM trades WHERE logical_id=$1 AND chain_id=$2 AND orphaned=false",
          [tradeId, config.chainId],
        );
        if (!trade.rows[0] || trade.rows[0].trader_address !== author)
          throw Object.assign(
            new Error(
              "Only the wallet that made this trade can attach a note.",
            ),
            { status: 403 },
          );
        if (note) {
          await pool.query(
            `INSERT INTO trade_notes (logical_trade_id,chain_id,author_address,note) VALUES ($1,$2,$3,$4)
            ON CONFLICT (logical_trade_id) DO UPDATE SET note=EXCLUDED.note,updated_at=now()`,
            [tradeId, config.chainId, author, note],
          );
        } else {
          await pool.query(
            "DELETE FROM trade_notes WHERE logical_trade_id=$1 AND author_address=$2",
            [tradeId, author],
          );
        }
        return send(request, response, 200, { note: note || null });
      }

      if (request.method === "POST" && url.pathname === "/v1/trade-reactions") {
        const reactor = await requirePrivyWallet(request);
        limitSocialWrite(request, reactor);
        const body = await readJson(request);
        const tradeId = typeof body.tradeId === "string" ? body.tradeId : "";
        const trade = await pool.query(
          "SELECT trader_address,token_address FROM trades WHERE logical_id=$1 AND chain_id=$2 AND orphaned=false",
          [tradeId, config.chainId],
        );
        if (!trade.rows[0])
          throw Object.assign(new Error("Trade not found."), { status: 404 });
        if (body.active === false)
          await pool.query(
            "DELETE FROM trade_reactions WHERE logical_trade_id=$1 AND reactor_address=$2",
            [tradeId, reactor],
          );
        else {
          await pool.query(
            "INSERT INTO trade_reactions (logical_trade_id,chain_id,reactor_address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            [tradeId, config.chainId, reactor],
          );
          // Conviction is only worth telling someone about when another wallet gave it.
          if (trade.rows[0].trader_address !== reactor) {
            await pool.query(
              `INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
              SELECT $1,$2,'reaction',$3,$4,$5::jsonb
              WHERE COALESCE((SELECT in_app FROM notification_preferences WHERE chain_id=$1 AND address=$2),true)=true
              ON CONFLICT DO NOTHING`,
              [
                config.chainId,
                trade.rows[0].trader_address,
                reactor,
                `${tradeId}:reaction:${reactor}`,
                JSON.stringify({
                  tradeId,
                  tokenAddress: trade.rows[0].token_address,
                }),
              ],
            );
          }
        }
        const count = await pool.query(
          "SELECT COUNT(*) AS count FROM trade_reactions WHERE logical_trade_id=$1",
          [tradeId],
        );
        return send(request, response, 200, {
          active: body.active !== false,
          count: Number(count.rows[0].count),
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/reports") {
        await requireModerator(request, false);
        const status = url.searchParams.get("status") || "open";
        if (
          !new Set(["open", "reviewing", "actioned", "dismissed", "all"]).has(
            status,
          )
        ) {
          throw Object.assign(new Error("Unknown report status."), {
            status: 400,
          });
        }
        const result = await pool.query(
          `SELECT id,reporter_address,subject_address,subject_trade_id,reason,details,status,
            resolution_note,resolved_at,created_at FROM reports
          WHERE chain_id=$1 AND ($2='all' OR status=$2) ORDER BY created_at ASC LIMIT $3`,
          [config.chainId, status, boundedLimit(url, 50, 100)],
        );
        return send(request, response, 200, { items: result.rows });
      }

      const reportAdminMatch = url.pathname.match(
        /^\/v1\/admin\/reports\/(\d+)$/,
      );
      if (request.method === "PATCH" && reportAdminMatch) {
        await requireModerator(request);
        const body = await readJson(request);
        const status = typeof body.status === "string" ? body.status : "";
        const resolutionNote =
          typeof body.resolutionNote === "string"
            ? body.resolutionNote.trim().slice(0, 1_000)
            : "";
        if (!new Set(["reviewing", "actioned", "dismissed"]).has(status)) {
          throw Object.assign(new Error("Choose a valid moderation status."), {
            status: 400,
          });
        }
        const result = await pool.query(
          `UPDATE reports SET status=$1,resolution_note=$2,
            resolved_at=CASE WHEN $1 IN ('actioned','dismissed') THEN now() ELSE NULL END
          WHERE id=$3 AND chain_id=$4 RETURNING id,status,resolution_note,resolved_at`,
          [status, resolutionNote, reportAdminMatch[1], config.chainId],
        );
        if (!result.rows[0])
          throw Object.assign(new Error("Report not found."), { status: 404 });
        return send(request, response, 200, result.rows[0]);
      }

      if (request.method === "GET" && url.pathname === "/v1/notifications") {
        const address = await requirePrivyWallet(request, false);
        const [result, unread] = await Promise.all([
          pool.query(
            `SELECT n.id,n.kind,n.actor_address,
              n.payload || jsonb_strip_nulls(jsonb_build_object(
                'tokenName',m.name,'tokenSymbol',m.symbol
              )) AS payload,n.read_at,n.created_at
            FROM notifications n
            LEFT JOIN markets m ON m.chain_id=n.chain_id AND m.token_address=n.payload->>'tokenAddress'
            WHERE n.chain_id=$1 AND n.recipient_address=$2
              AND ($3::text[] IS NULL OR n.kind=ANY($3::text[]))
            ORDER BY n.created_at DESC LIMIT $4`,
            [
              config.chainId,
              address,
              url.searchParams.getAll("kind").length
                ? url.searchParams.getAll("kind")
                : null,
              boundedLimit(url, 30, 100),
            ],
          ),
          pool.query(
            "SELECT COUNT(*) AS unread FROM notifications WHERE chain_id=$1 AND recipient_address=$2 AND read_at IS NULL",
            [config.chainId, address],
          ),
        ]);
        return send(request, response, 200, {
          items: result.rows,
          unreadCount: Number(unread.rows[0]?.unread || 0),
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/notification-preferences"
      ) {
        const address = await requirePrivyWallet(request, false);
        const result = await pool.query(
          "SELECT in_app,trade_buys,trade_sells,launches,graduations,new_followers FROM notification_preferences WHERE chain_id=$1 AND address=$2",
          [config.chainId, address],
        );
        return send(
          request,
          response,
          200,
          result.rows[0] || {
            in_app: true,
            trade_buys: true,
            trade_sells: true,
            launches: true,
            graduations: true,
            new_followers: true,
          },
        );
      }
      if (
        request.method === "PATCH" &&
        url.pathname === "/v1/notification-preferences"
      ) {
        const address = await requirePrivyWallet(request);
        limitSocialWrite(request, address);
        const body = await readJson(request);
        const values = [
          "inApp",
          "tradeBuys",
          "tradeSells",
          "launches",
          "graduations",
          "newFollowers",
        ].map((key) => body[key] !== false);
        const result = await pool.query(
          `INSERT INTO notification_preferences (chain_id,address,in_app,trade_buys,trade_sells,launches,graduations,new_followers)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (chain_id,address) DO UPDATE SET
          in_app=EXCLUDED.in_app,trade_buys=EXCLUDED.trade_buys,trade_sells=EXCLUDED.trade_sells,
          launches=EXCLUDED.launches,graduations=EXCLUDED.graduations,new_followers=EXCLUDED.new_followers
          RETURNING in_app,trade_buys,trade_sells,launches,graduations,new_followers`,
          [config.chainId, address, ...values],
        );
        return send(request, response, 200, result.rows[0]);
      }
      if (
        request.method === "PATCH" &&
        url.pathname === "/v1/notifications/read"
      ) {
        const address = await requirePrivyWallet(request);
        limitSocialWrite(request, address);
        const body = await readJson(request);
        const ids = Array.isArray(body.ids)
          ? body.ids
              .filter(
                (id) =>
                  (Number.isInteger(id) && id >= 0) ||
                  (typeof id === "string" && /^\d+$/.test(id)),
              )
              .slice(0, 100)
          : [];
        await pool.query(
          "UPDATE notifications SET read_at=now() WHERE chain_id=$1 AND recipient_address=$2 AND id=ANY($3::bigint[])",
          [config.chainId, address, ids],
        );
        return send(request, response, 200, { ok: true });
      }

      return send(request, response, 404, { error: "Endpoint not found." });
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) {
        captureBackendException(error, "api");
        console.error(error);
      }
      if (response.headersSent) return response.end();
      return send(
        request,
        response,
        status,
        {
          error:
            status >= 500
              ? "The social service could not complete this request."
              : error.message,
        },
        error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
      );
    }
  });
}

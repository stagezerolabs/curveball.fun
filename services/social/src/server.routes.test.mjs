import assert from "node:assert/strict";
import test from "node:test";

// The HTTP server reads configuration at import time. No connection is opened;
// each test injects its own query and authentication functions.
process.env.SOCIAL_DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/curveball_test";
process.env.SOCIAL_LAUNCHPAD_ADDRESS ||= "0x0000000000000000000000000000000000000010";
process.env.SOCIAL_DEPLOYMENT_BLOCK ||= "1";
process.env.PRIVY_APP_ID ||= "test-app";
process.env.PRIVY_APP_SECRET ||= "test-secret";

const { createSocialServer } = await import("./server.mjs");
const origin = "http://localhost:5173";
const wallets = {
  viewer: "0x0000000000000000000000000000000000000001",
  followed: "0x0000000000000000000000000000000000000002",
  other: "0x0000000000000000000000000000000000000003",
  anotherViewer: "0x0000000000000000000000000000000000000004",
};

async function withServer(query, run, transaction) {
  const calls = [];
  const recordedQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    const result = await query(sql, params);
    return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
  };
  const server = createSocialServer({
    query: recordedQuery,
    transaction: transaction || (async (callback) => callback({ query: recordedQuery })),
    authenticate: async (request) => request.headers["x-test-wallet"]
      ? { address: request.headers["x-test-wallet"] } : null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { wallet, method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { origin, ...(wallet ? { "x-test-wallet": wallet } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ request, calls }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("Following buys requires a linked viewer and never falls back to all wallets", async () => {
  await withServer(async () => { throw new Error("Anonymous Following must not query the database."); },
    async ({ request }) => {
      const response = await request("/v1/following/buys?period=24h");
      assert.equal(response.status, 401);
      assert.match(response.body.error, /sign in/i);
    });

  await withServer(async () => [], async ({ request, calls }) => {
    const response = await request("/v1/following/buys?period=24h", { wallet: wallets.viewer });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, { scope: "following", period: "24h", items: [] });
    assert.equal(calls.some(({ sql }) => sql.includes("FROM trades")), false);
  });
});

test("Following buys uses only followed wallets in the selected window", async () => {
  await withServer(async (sql) => {
    if (sql.includes("SELECT followed_address AS address FROM follows")) return [{ address: wallets.followed }];
    if (sql.includes("WITH") && sql.includes("FROM trades")) return [{
      token_address: wallets.other, token_name: "Token", token_symbol: "TKN",
      bought_quote_wei: "100", buyers: [{ address: wallets.followed, displayName: "Alice" }],
    }];
    if (sql.includes("FROM blocks")) return [];
    throw new Error(`Unexpected query: ${sql}`);
  }, async ({ request, calls }) => {
    const response = await request("/v1/following/buys?period=24h", { wallet: wallets.anotherViewer });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.period, "24h");
    assert.deepEqual(response.body.items[0]?.buyers, [{ address: wallets.followed, displayName: "Alice" }],
      JSON.stringify({ body: response.body, calls: calls.map(({ sql }) => sql.slice(0, 100)) }));
    const tradeQuery = calls.find(({ sql }) => sql.includes("FROM trades"));
    assert.ok(tradeQuery);
    assert.equal(tradeQuery.params[1], wallets.anotherViewer);
    assert.equal(tradeQuery.params[3], "24 hours");
    assert.match(tradeQuery.sql, /follower_address\s*=\s*\$2/i);
    assert.match(tradeQuery.sql, /orphaned\s*=\s*false/i);
    assert.match(tradeQuery.sql, /latest.*is_buy/is);
  });
});

test("new follows require an opted-in profile and opting out removes incoming follows", async () => {
  let visible = false;
  await withServer(async (sql) => {
    if (sql.includes("SELECT 1 FROM blocks")) return [];
    if (sql.includes("SELECT 1 FROM profiles")) return visible ? [{ ok: 1 }] : [];
    if (sql.includes("INSERT INTO follows")) return [{ followed_address: wallets.followed }];
    return [];
  }, async ({ request, calls }) => {
    const hidden = await request(`/v1/follows/${wallets.followed}`, {
      wallet: wallets.viewer, method: "POST",
    });
    assert.equal(hidden.status, 409);
    assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO follows")), false);

    visible = true;
    const followed = await request(`/v1/follows/${wallets.followed}`, {
      wallet: wallets.viewer, method: "POST",
    });
    assert.deepEqual(followed, { status: 200, body: { following: true } });
    assert.ok(calls.some(({ sql }) => sql.includes("new_followers") && sql.includes("INSERT INTO notifications")));

    const optOut = await request("/v1/profiles/me", {
      wallet: wallets.followed, method: "POST",
      body: { displayName: "Alice", bio: "", discoverable: false },
    });
    assert.equal(optOut.status, 200, JSON.stringify(optOut.body));
    assert.ok(calls.some(({ sql, params }) => sql.includes("DELETE FROM follows")
      && sql.includes("followed_address=$2") && params[1] === wallets.followed));
  });
});

test("profile discovery and relationship lists keep opt-in and block filters through pagination", async () => {
  await withServer(async (sql) => {
    if (sql.includes("FROM profiles p")) return [
      { address: wallets.followed, display_name: "Alice", bio: "", followers: "2", is_followed: true },
      { address: wallets.other, display_name: "Bob", bio: "", followers: "1", is_followed: false },
    ];
    throw new Error(`Unexpected query: ${sql}`);
  }, async ({ request, calls }) => {
    const first = await request("/v1/profiles?search=Alice&limit=1", { wallet: wallets.viewer });
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 1);
    assert.ok(first.body.nextCursor);
    const list = await request(`/v1/profiles/${wallets.viewer}/following?limit=1`, { wallet: wallets.viewer });
    assert.equal(list.status, 200);
    const queries = calls.filter(({ sql }) => sql.includes("FROM profiles p"));
    assert.equal(queries.length, 2);
    for (const { sql } of queries) {
      assert.match(sql, /p\.discoverable\s*=\s*true/i);
      assert.match(sql, /FROM blocks b/i);
    }
    assert.match(queries[1].sql, /f\.follower_address\s*=\s*\$5/i);
  });
});

test("trade reports verify canonical ownership before recording a trade target", async () => {
  const tradeId = "0xtrade:0";
  await withServer(async (sql) => {
    if (sql.includes("SELECT trader_address FROM trades")) return [{ trader_address: wallets.followed }];
    return [];
  }, async ({ request, calls }) => {
    const rejected = await request("/v1/reports", { wallet: wallets.viewer, method: "POST",
      body: { subjectAddress: wallets.other, tradeId, reason: "spam" } });
    assert.equal(rejected.status, 400);
    assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO reports")), false);

    const accepted = await request("/v1/reports", { wallet: wallets.viewer, method: "POST",
      body: { subjectAddress: wallets.followed, tradeId, reason: "spam" } });
    assert.equal(accepted.status, 201);
    const insert = calls.find(({ sql }) => sql.includes("INSERT INTO reports"));
    assert.ok(insert);
    assert.match(insert.sql, /subject_trade_id/);
    assert.equal(insert.params[3], tradeId);
    const lookup = calls.find(({ sql }) => sql.includes("SELECT trader_address FROM trades"));
    assert.match(lookup.sql, /orphaned\s*=\s*false/i);
  });
});

test("canonical trade remains in feed while an actioned report hides its note", async () => {
  const feedRow = {
    id: "trade:1", trader_address: wallets.followed, is_buy: true,
    quote_amount_wei: "100", token_amount_wei: "1000", virtual_quote_after: "5",
    virtual_token_after: "6", transaction_hash: "0xhash", log_index: 0,
    block_timestamp: "2026-10-19T12:00:00.000Z", token_address: wallets.other,
    token_name: "Token", token_symbol: "TKN", launchpad_address: wallets.other,
    display_name: "Alice", note: null, reaction_count: "1", reacted: false,
    is_followed: false, follower_count: "0",
  };
  await withServer(async (sql) => {
    if (sql.includes("FROM trades t") && sql.includes("LEFT JOIN trade_notes")) return [feedRow];
    throw new Error(`Unexpected query: ${sql}`);
  }, async ({ request, calls }) => {
    const response = await request("/v1/feed");
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.items[0].id, feedRow.id);
    assert.equal(response.body.items[0].note, null);
    const sql = calls[0].sql;
    assert.match(sql, /t\.orphaned\s*=\s*false/i);
    assert.match(sql, /r\.subject_trade_id\s*=\s*t\.logical_id/i);
    assert.match(sql, /r\.status\s*=\s*'actioned'/i);
  });
});

test("market history keeps canonical trades after note moderation and excludes orphaned events", async () => {
  await withServer(async (sql) => {
    if (sql.includes("WITH activity AS")) return [{
      logical_id: "trade:2", participant_address: wallets.followed,
      participant_role: "trader", execution_sender_address: null,
      venue_type: "curve", venue_address: wallets.other, is_buy: true,
      gross_curve_quote: "100", net_trader_quote: "99", fee_quote: "1",
      creator_tax_quote: "0", token_amount: "1000", virtual_quote_after: "5",
      virtual_token_after: "6", sold_after: "1000", transaction_hash: "0xhash",
      block_number: "10", log_index: 0, block_timestamp: "2026-10-19T12:00:00.000Z",
      note: null, reaction_count: "1", reacted: false,
    }];
    throw new Error(`Unexpected query: ${sql}`);
  }, async ({ request, calls }) => {
    const response = await request(`/v1/markets/${wallets.other}/trades`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.items[0].id, "trade:2");
    assert.equal(response.body.items[0].note, null);
    const sql = calls[0].sql;
    assert.equal((sql.match(/orphaned\s*=\s*false/gi) || []).length, 2);
    assert.match(sql, /r\.subject_trade_id\s*=\s*activity\.logical_id/i);
    assert.match(sql, /r\.status\s*=\s*'actioned'/i);
  });
});

test("notifications include every kind, paginate, count unread, and preserve partial preferences", async () => {
  const dates = ["2026-10-19T12:03:00.000Z", "2026-10-19T12:02:00.000Z", "2026-10-19T12:01:00.000Z"];
  const rows = ["new_follower", "reaction", "graduation"].map((kind, index) => ({
    id: String(3 - index), kind, actor_address: wallets.followed, payload: {},
    read_at: null, created_at: dates[index],
  }));
  await withServer(async (sql, params) => {
    if (sql.includes("SELECT n.id,n.kind")) return params[2] ? [rows[2]] : rows;
    if (sql.includes("COUNT(*) AS count FROM notifications")) return [{ count: "3" }];
    if (sql.includes("FROM notification_preferences") && sql.includes("SELECT")) return [];
    if (sql.includes("INSERT INTO notification_preferences")) return [{
      in_app: true, trade_buys: true, trade_sells: true, graduations: true, new_followers: false,
    }];
    throw new Error(`Unexpected query: ${sql}`);
  }, async ({ request, calls }) => {
    const unauthenticated = await request("/v1/notifications");
    assert.equal(unauthenticated.status, 401);

    const first = await request("/v1/notifications?limit=2", { wallet: wallets.viewer });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items.map(({ kind }) => kind), ["new_follower", "reaction"]);
    assert.equal(first.body.unreadCount, 3);
    assert.ok(first.body.nextCursor);
    const second = await request(`/v1/notifications?limit=2&cursor=${first.body.nextCursor}`, { wallet: wallets.viewer });
    assert.deepEqual(second.body.items.map(({ kind }) => kind), ["graduation"]);
    assert.equal(second.body.nextCursor, null);
    const listSql = calls.find(({ sql }) => sql.includes("SELECT n.id,n.kind")).sql;
    assert.doesNotMatch(listSql, /n\.kind\s*=\s*ANY/i);
    assert.match(listSql, /FROM blocks b/i);

    const defaults = await request("/v1/notification-preferences", { wallet: wallets.viewer });
    assert.equal(defaults.body.new_followers, true);
    const patched = await request("/v1/notification-preferences", {
      wallet: wallets.viewer, method: "PATCH", body: { newFollowers: false },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.new_followers, false);
    const update = calls.find(({ sql }) => sql.includes("INSERT INTO notification_preferences"));
    assert.deepEqual(update.params.slice(2), [null, null, null, null, false]);
  });
});

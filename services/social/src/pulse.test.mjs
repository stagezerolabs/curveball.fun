import assert from "node:assert/strict";
import test from "node:test";
import { shapePublicPulseMoments } from "./pulse.mjs";

const row = {
  token_address: "0xabc",
  token_name: "Alpha",
  token_symbol: "ALP",
  first_at: "2026-10-18T11:00:00Z",
  latest_at: "2026-10-18T11:55:00Z",
  trade_count: "101",
  buy_count: "100",
  sell_count: "1",
  distinct_wallet_count: "4",
  buy_quote_wei: "123456789012345678901234567890",
  sell_quote_wei: "7",
  transaction_hash: "0xaaa",
};

test("public Pulse shaping preserves exact large quote totals and observed wallet counts", () => {
  const [moment] = shapePublicPulseMoments([row]);
  assert.equal(moment.netQuoteWei, (BigInt(row.buy_quote_wei) - 7n).toString());
  assert.equal(moment.tradeCount, 101);
  assert.equal(moment.distinctWalletCount, 4);
  assert.equal(moment.followedTraderCount, 0);
  assert.equal(moment.reason, "net_buying");
  assert.equal(moment.sampleTransactionHash, "0xaaa");
});

test("Following labels filtered wallet count and the reason accurately", () => {
  const [moment] = shapePublicPulseMoments(
    [{ ...row, buy_quote_wei: "0", sell_quote_wei: "30" }],
    { scope: "following" },
  );
  assert.equal(moment.followedTraderCount, 4);
  assert.equal(moment.reason, "following");
  assert.equal(moment.netQuoteWei, "-30");
});

test("Now SQL keeps only net-buying markets and ranks them by net inflow", async () => {
  const { nowPulseSql } = await import("./pulseSql.mjs");
  assert.match(
    nowPulseSql,
    /HAVING COALESCE\(SUM\(t\.net_trader_quote\) FILTER \(WHERE t\.is_buy\),0\)\s+> COALESCE/,
  );
  assert.match(
    nowPulseSql,
    /- COALESCE\(SUM\(t\.net_trader_quote\) FILTER \(WHERE NOT t\.is_buy\),0\) DESC,latest_at DESC/,
  );
  assert.match(nowPulseSql, /LIMIT 12/);
});

test("Following SQL reports each followed wallet's launches, buys, and sells", async () => {
  const { followingActivitySql } = await import("./pulseSql.mjs");
  assert.match(followingActivitySql, /'launch'::text AS action/);
  assert.match(followingActivitySql, /m\.creator_address=ANY\(\$2::text\[\]\)/);
  assert.match(
    followingActivitySql,
    /CASE WHEN t\.is_buy THEN 'buy' ELSE 'sell' END/,
  );
  // The tab has no "every wallet" mode: a Following list of strangers is not a follow graph.
  assert.doesNotMatch(followingActivitySql, /\$2::text\[\] IS NULL/);
  assert.match(
    followingActivitySql,
    /GROUP BY token_address,actor_address,action/,
  );
});

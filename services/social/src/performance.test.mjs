import { describe, expect, test } from "bun:test";

process.env.SOCIAL_DATABASE_URL ||=
  "postgres://unused:unused@localhost:5432/unused";
process.env.SOCIAL_LAUNCHPAD_ADDRESS ||=
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
process.env.SOCIAL_DEPLOYMENT_BLOCK ||= "1";
process.env.PRIVY_APP_ID ||= "unused";
process.env.PRIVY_APP_SECRET ||= "unused";

const {
  LEADERBOARD_RULES,
  PERFORMANCE_METHODOLOGY,
  publishLeaderboards,
  refreshPerformanceSnapshot,
} = await import("./performance.mjs");

function recordingDb() {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [{ id: `snapshot-${queries.length}` }] };
    },
  };
  return { db, queries };
}

describe("published trader rankings", () => {
  test("uses full known-basis net PnL over cumulative buys for the return snapshot", async () => {
    const { db, queries } = recordingDb();
    await refreshPerformanceSnapshot(db, "0xtrader", 42n);

    expect(PERFORMANCE_METHODOLOGY).toBe("curve-known-basis-v2");
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(
      /\(p\.realized_pnl\+p\.unrealized_pnl\)\*10000\.0\/p\.invested/,
    );
    expect(queries[0].values.at(-1)).toBe(PERFORMANCE_METHODOLOGY);
  });

  test("requires a meaningful sample and a priced, intact position for Track record", async () => {
    const { db, queries } = recordingDb();
    await publishLeaderboards(db, 42n);

    const inserts = queries.filter(({ sql }) =>
      sql.includes("INSERT INTO leaderboard_rows"),
    );
    expect(inserts).toHaveLength(1);
    const { sql, values } = inserts[0];
    expect(sql).toMatch(/candidate AS MATERIALIZED/);
    expect(sql).toContain(
      `categories.category='consistent' AND candidate.trade_count>=${LEADERBOARD_RULES.establishedTrades}`,
    );
    expect(sql).toContain(
      `candidate.trading_day_count>=${LEADERBOARD_RULES.establishedTradingDays}`,
    );
    expect(sql).toContain(
      `candidate.market_count>=${LEADERBOARD_RULES.establishedMarkets}`,
    );
    expect(sql).toContain(
      `candidate.invested_quote>=${LEADERBOARD_RULES.minimumInvestedWei}`,
    );
    expect(sql).toMatch(
      /candidate\.realized_pnl_quote\+candidate\.marked_unrealized_pnl_quote>0/,
    );
    expect(sql).toMatch(/AS marked_unrealized_pnl_quote/);
    expect(sql).toMatch(
      /holdings\.effective_balance\*COALESCE\(holdings\.current_price_x18,0\)/,
    );
    expect(sql).toMatch(
      /candidate\.stale_open_market_count=0 AND candidate\.external_outbound_count=0/,
    );
    expect(sql).toMatch(/activity_window\.day0_epoch/);
    expect(sql).toMatch(
      /COUNT\(DISTINCT \(EXTRACT\(EPOCH FROM t\.block_timestamp\)::bigint-activity_window\.day0_epoch\)\/86400\)/,
    );
    expect(sql).toMatch(/'realizedCostWei'/);
    expect(sql).toMatch(/'netPnlWei'/);
    expect(sql).toMatch(/'tradingDayCount'/);
    expect(sql).toMatch(/'methodologyCaveat'/);
    expect(sql).toMatch(/'recentVolumeWei'/);
    expect(sql).toMatch(/'volumeWei'/);
    expect(values.slice(-4)).toEqual([
      "snapshot-1",
      "snapshot-3",
      "snapshot-5",
      "snapshot-7",
    ]);
  });

  test("Emerging is recent and provisional, ranked by PnL rather than arrival or trade frequency", async () => {
    const { db, queries } = recordingDb();
    await publishLeaderboards(db, 42n);

    const { sql } = queries.find(({ sql }) =>
      sql.includes("INSERT INTO leaderboard_rows"),
    );
    expect(sql).toContain(
      `categories.category='new' AND candidate.trade_count>=${LEADERBOARD_RULES.emergingTrades}`,
    );
    expect(sql).toContain(
      `candidate.trading_day_count>=${LEADERBOARD_RULES.emergingTradingDays}`,
    );
    expect(sql).toContain(
      `candidate.market_count>=${LEADERBOARD_RULES.emergingMarkets}`,
    );
    expect(sql).toContain(
      `candidate.first_trade_at>now()-interval '${LEADERBOARD_RULES.emergingWindowDays} days'`,
    );
    expect(sql).toMatch(
      /'sampleLabel',CASE WHEN categories\.category='consistent' THEN 'established' ELSE 'provisional'/,
    );
    expect(sql).toMatch(
      /WHEN categories\.category='new' THEN \(candidate\.realized_pnl_quote\+candidate\.marked_unrealized_pnl_quote\)\/1000000000000000000\.0/,
    );
  });
});

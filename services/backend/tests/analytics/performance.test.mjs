import { describe, expect, test } from "bun:test";

process.env.SOCIAL_DATABASE_URL ||=
  "postgres://unused:unused@localhost:5432/unused";
process.env.SOCIAL_LAUNCHPAD_ADDRESS ||=
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
process.env.SOCIAL_ADMIN_ADDRESS ||=
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
process.env.SOCIAL_DEPLOYMENT_BLOCK ||= "1";
process.env.PRIVY_APP_ID ||= "test-privy-app";
process.env.PRIVY_APP_SECRET ||= "test-privy-secret";

const {
  PERFORMANCE_METHODOLOGY,
  PERFORMANCE_SNAPSHOT_METHODOLOGY,
  publishLeaderboards,
  refreshPerformanceSnapshot,
} = await import("../../src/analytics/performance.mjs");
const { AS_OF, DAY, E, LAUNCHPAD, eventFactory } = await import(
  "./ledgerFixtures.mjs"
);

const milli = (n) => (BigInt(n) * E) / 1000n;

// Answers the bulk loads from seeded rows and records every statement.
function recordingDb(seed = {}) {
  const queries = [];
  let ids = 0;
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/RETURNING id/.test(sql)) return { rows: [{ id: `snapshot-${++ids}` }] };
      if (/FROM markets m/.test(sql)) return { rows: seed.markets ?? [] };
      if (/FROM trades t/.test(sql)) return { rows: seed.trades ?? [] };
      if (/FROM asset_transfers a/.test(sql)) return { rows: seed.transfers ?? [] };
      if (/FROM protocol_accounts/.test(sql)) return { rows: seed.protocol ?? [] };
      if (/FROM follows/.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
  };
  return { db, queries };
}

function seededRanking() {
  const f = eventFactory();
  for (const token of ["0xa", "0xb", "0xc"]) {
    for (let i = 0; i < 5; i++) {
      f.buy(`0xcrowd${i}`, token, 1000n, milli(1) / 10n, { at: AS_OF - 30 * DAY + i });
    }
  }
  const tokens = ["0xa", "0xb", "0xc", "0xa", "0xb", "0xc"];
  tokens.forEach((token, i) => {
    const at = AS_OF - 20 * DAY + i * DAY;
    f.buy("0xgood", token, 1000n, milli(50), { at });
    f.sell("0xgood", token, 1000n, milli(60), { at: at + 60 });
  });
  const vQ = 2n * E;
  const vT = (10n ** 27n * E + vQ - 1n) / vQ;
  const markets = ["0xa", "0xb", "0xc"].map((token) => ({
    token_address: token,
    creator_address: "0xcreator",
    launchpad_address: LAUNCHPAD,
    launch_block: "1",
    launched_at_epoch: String(AS_OF - 40 * DAY),
    initial_virtual_quote: E.toString(),
    total_supply: (10n ** 9n * E).toString(),
    fee_bps: 75,
    creator_tax_bps: 0,
    state: "trading",
    graduation_block: null,
  }));
  const trades = f.events
    .filter((e) => e.kind === "trade")
    .map((e) => ({
      token_address: e.token,
      trader_address: e.trader,
      is_buy: e.isBuy,
      token_amount: e.tokenAmount.toString(),
      net_trader_quote: e.netQuote.toString(),
      anti_snipe_tax_quote: "0",
      virtual_quote_after: vQ.toString(),
      virtual_token_after: vT.toString(),
      block_number: e.blockNumber.toString(),
      transaction_index: e.txIndex,
      log_index: e.logIndex,
      at_epoch: String(e.at),
    }));
  const transfers = f.events
    .filter((e) => e.kind === "transfer")
    .map((e) => ({
      token_address: e.token,
      from_address: e.from,
      to_address: e.to,
      amount: e.amount.toString(),
      block_number: e.blockNumber.toString(),
      transaction_index: e.txIndex,
      log_index: e.logIndex,
      at_epoch: String(e.at),
    }));
  return { markets, trades, transfers, protocol: [{ address: LAUNCHPAD }] };
}

const asOfDate = new Date(AS_OF * 1000);

describe("v3 leaderboard publishing", () => {
  test("publishes v3 snapshots with status and details", async () => {
    const { db, queries } = recordingDb();
    const summary = await publishLeaderboards(db, 42n, asOfDate);
    expect(PERFORMANCE_METHODOLOGY).toBe("curve-exit-realized-v3");
    const snapshots = queries.filter(({ sql }) =>
      sql.includes("INSERT INTO leaderboard_snapshots"),
    );
    expect(snapshots).toHaveLength(4);
    for (const { sql, values } of snapshots) {
      expect(sql).toMatch(/status/);
      expect(sql).toMatch(/details/);
      expect(sql).toMatch(/as_of_time/);
      expect(values).toContain("curve-exit-realized-v3");
      expect(values).toContain("no_qualifiers");
      const details = JSON.parse(values.find((v) => String(v).startsWith("{")));
      expect(details.rules.methodologyVersion).toBe("curve-exit-realized-v3");
      expect(details.watching).toEqual([]);
    }
    expect(summary.categories.consistent.status).toBe("no_qualifiers");
    expect(typeof summary.durationMs).toBe("number");
  });

  test("loads only rows at or before asOfBlock, excluding orphans", async () => {
    const { db, queries } = recordingDb();
    await publishLeaderboards(db, 42n, asOfDate);
    for (const table of ["FROM trades t", "FROM asset_transfers a"]) {
      const load = queries.find(({ sql }) => sql.includes(table));
      expect(load.sql).toMatch(/block_number<=\$2/);
      expect(load.sql).toMatch(/orphaned=false/);
      expect(load.sql).toMatch(/ORDER BY .*block_number,.*transaction_index NULLS LAST,.*log_index/s);
      expect(load.values[1]).toBe("42");
    }
  });

  test("inserts ranked rows with the shrunk score and v3 metrics", async () => {
    const { db, queries } = recordingDb(seededRanking());
    const summary = await publishLeaderboards(db, 1_000_000n, asOfDate);
    expect(summary.categories.consistent).toEqual({ status: "ranked", rows: 1 });
    const inserts = queries.filter(({ sql }) =>
      sql.includes("INSERT INTO leaderboard_rows"),
    );
    const rows = inserts.flatMap(({ values }) => JSON.parse(values[1]));
    const consistent = rows.find((row) => row.metrics.entityId === "0xgood");
    expect(consistent.rank).toBe(1);
    // floor(0.06e18 * 12 / 20) wei, stored as WETH with 18 decimals.
    expect(consistent.score).toBe("0.036000000000000000");
    expect(consistent.metrics.scoreWei).toBe("36000000000000000");
    expect(consistent.metrics.netPnlWei).toBe("60000000000000000");
  });

  test("never reads mixed methodology versions", async () => {
    const { db, queries } = recordingDb();
    await publishLeaderboards(db, 42n, asOfDate);
    for (const { sql } of queries) {
      expect(sql).not.toContain("curve-known-basis-v1");
      expect(sql).not.toMatch(/DISTINCT ON/i);
      expect(sql).not.toContain("trader_performance_snapshots");
    }
  });

  test("retention only prunes v3", async () => {
    const { db, queries } = recordingDb();
    await publishLeaderboards(db, 42n, asOfDate);
    const prune = queries.find(({ sql }) =>
      sql.includes("DELETE FROM leaderboard_snapshots"),
    );
    expect(prune.sql).toMatch(/methodology_version=\$2/);
    expect(prune.sql).toMatch(/interval '7 days'/);
    expect(prune.values[1]).toBe("curve-exit-realized-v3");
  });

  test("refreshPerformanceSnapshot keeps the v2 label", async () => {
    const { db, queries } = recordingDb();
    await refreshPerformanceSnapshot(db, "0xtrader", 42n);
    expect(PERFORMANCE_SNAPSHOT_METHODOLOGY).toBe("curve-known-basis-v2");
    expect(queries).toHaveLength(1);
    expect(queries[0].values.at(-1)).toBe("curve-known-basis-v2");
  });
});

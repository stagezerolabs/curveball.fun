import { describe, expect, test } from "bun:test";

import {
  publishedSnapshotQuery,
  shapeLeaderboardResponse,
} from "../../../../src/api/features/pulse/leaderboardResponse.mjs";
import * as pulseSql from "../../../../src/analytics/pulseSql.mjs";

const NOW = new Date("2026-11-26T12:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000);
const graph = (blocked = []) => ({
  blocked: new Set(blocked),
  followed: new Set(["0xa"]),
});

function snapshot(overrides = {}) {
  return {
    id: "snap-1",
    period: "all",
    methodology_version: "curve-exit-realized-v3",
    as_of_block: "980",
    as_of_time: minutesAgo(2),
    calculated_at: minutesAgo(2),
    published_at: minutesAgo(2),
    status: "ranked",
    details: { rules: { minQualifyingTrades: 10 }, watching: [], progress: [] },
    ...overrides,
  };
}

const metrics = {
  realizedPnlWei: "30000000000000000",
  realizedCostWei: "100000000000000000",
  netPnlWei: "40000000000000000",
  returnBps: 4000,
  qualifyingTradeCount: 12,
  tradeCount: 14,
  marketCount: 3,
  confidence: "developing",
  firstTradeAt: "2026-11-01T00:00:00.000Z",
  lastTradeAt: "2026-11-20T00:00:00.000Z",
};

describe("leaderboard response", () => {
  test("no snapshot of the current version returns pending, never a provisional ranking", () => {
    const body = shapeLeaderboardResponse({
      category: "consistent",
      snapshot: null,
      rows: [],
      graph: graph(),
      limit: 12,
      now: NOW,
    });
    expect(body.status).toBe("pending");
    expect(body.items).toEqual([]);
    expect(body.watching).toEqual([]);
    expect(body.rules.minQualifyingTrades).toBe(10);
    expect(body).not.toHaveProperty("provisional");
  });

  test("a v2 snapshot is ignored", () => {
    const query = publishedSnapshotQuery(4153, "consistent");
    expect(query.text).toMatch(/methodology_version=\$3/);
    expect(query.values).toEqual([4153, "consistent", "curve-exit-realized-v3"]);
  });

  test("no_qualifiers returns empty items, watching with rank null and provisional true, rules and progress", () => {
    const watching = [
      {
        address: "0xw1",
        rank: null,
        provisional: true,
        qualifyingTradeCount: 6,
        marketCount: 2,
        activeDayCount: 2,
        requirementsMet: 2,
        requirementsTotal: 7,
        lastTradeAt: "2026-11-25T00:00:00.000Z",
      },
    ];
    const body = shapeLeaderboardResponse({
      category: "consistent",
      snapshot: snapshot({
        status: "no_qualifiers",
        details: {
          rules: { minQualifyingTrades: 10 },
          watching,
          progress: [{ requirementsMet: 2, requirementsTotal: 7, walletCount: 3 }],
        },
      }),
      rows: [],
      graph: graph(),
      limit: 12,
      now: NOW,
    });
    expect(body.status).toBe("no_qualifiers");
    expect(body.items).toEqual([]);
    expect(body.watching).toHaveLength(1);
    expect(body.watching[0].rank).toBeNull();
    expect(body.watching[0].provisional).toBe(true);
    expect(body.progress[0].walletCount).toBe(3);
    expect(body.rules.minQualifyingTrades).toBe(10);
    expect(body.methodologyVersion).toBe("curve-exit-realized-v3");
    expect(body.asOfBlock).toBe("980");
  });

  test("watching rows carry no returnBps or netPnlWei", () => {
    const body = shapeLeaderboardResponse({
      category: "new",
      snapshot: snapshot({
        status: "no_qualifiers",
        details: {
          rules: {},
          // Even if a stored row carried P&L, the API must not pass it through.
          watching: [{ address: "0xw", rank: null, provisional: true, returnBps: 9000, netPnlWei: "1" }],
          progress: [],
        },
      }),
      rows: [],
      graph: graph(),
      limit: 12,
      now: NOW,
    });
    expect(body.watching[0]).not.toHaveProperty("returnBps");
    expect(body.watching[0]).not.toHaveProperty("netPnlWei");
  });

  test("stale after 15 min and paused after 60", () => {
    const at = (m) =>
      shapeLeaderboardResponse({
        category: "consistent",
        snapshot: snapshot({ published_at: minutesAgo(m) }),
        rows: [],
        graph: graph(),
        limit: 12,
        now: NOW,
      });
    expect(at(14)).toMatchObject({ stale: false, paused: false, ageMinutes: 14 });
    expect(at(15)).toMatchObject({ stale: true, paused: false });
    expect(at(60)).toMatchObject({ stale: true, paused: true });
  });

  test("ranked items carry confidence and a BigInt realized return", () => {
    const body = shapeLeaderboardResponse({
      category: "consistent",
      snapshot: snapshot(),
      rows: [{ address: "0xa", rank: 1, published_metrics: metrics, follower_count: "4" }],
      graph: graph(),
      limit: 12,
      now: NOW,
    });
    expect(body.status).toBe("ranked");
    expect(body.items[0]).toMatchObject({
      address: "0xa",
      rank: 1,
      confidence: "developing",
      followers: 4,
      isFollowed: true,
    });
    expect(body.items[0].stats.realizedReturnPct).toBe(30);
    expect(body.items[0].stats.tradeCount).toBe(14);
  });

  test("blocked wallets are filtered", () => {
    const body = shapeLeaderboardResponse({
      category: "consistent",
      snapshot: snapshot({
        details: {
          rules: {},
          watching: [{ address: "0xbad", rank: null, provisional: true }],
          progress: [],
        },
      }),
      rows: [
        { address: "0xbad", rank: 1, published_metrics: metrics, follower_count: 0 },
        { address: "0xa", rank: 2, published_metrics: metrics, follower_count: 0 },
      ],
      graph: graph(["0xbad"]),
      limit: 12,
      now: NOW,
    });
    expect(body.items.map((item) => item.address)).toEqual(["0xa"]);
    expect(body.watching).toEqual([]);
  });

  test("followers is labelled Most followed", () => {
    const body = shapeLeaderboardResponse({
      category: "followers",
      snapshot: null,
      rows: [],
      graph: graph(),
      limit: 12,
      now: NOW,
    });
    expect(body.label).toBe("Most followed");
  });

  test("pulseSql no longer exports provisionalLeaderboardSql", () => {
    expect(pulseSql).not.toHaveProperty("provisionalLeaderboardSql");
  });
});

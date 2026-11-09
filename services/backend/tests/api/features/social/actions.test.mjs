import { describe, expect, test } from "bun:test";
import { configureTestEnvironment } from "../../../helpers/environment.mjs";

configureTestEnvironment();
const { createSocialActions } = await import("../../../../src/api/features/social/actions.mjs");
const alice = "0x0000000000000000000000000000000000000011";
const bob = "0x0000000000000000000000000000000000000022";

describe("social actions", () => {
  test("following rejects a block before it writes and leaves caches untouched", async () => {
    const queries = [];
    const invalidations = [];
    const actions = createSocialActions({
      chainId: 4153,
      runTransaction: async (work) => work({
        query: async (sql, values) => {
          queries.push({ sql, values });
          return { rowCount: 1 };
        },
      }),
      onFollow: (address) => invalidations.push(address),
      onLeaderboardChange: () => invalidations.push("leaderboard"),
    });
    await expect(actions.setFollow(alice, bob, true)).rejects.toMatchObject({ status: 409 });
    expect(queries).toHaveLength(1);
    expect(queries[0].values).toEqual([4153, alice, bob]);
    expect(invalidations).toEqual([]);
  });

  test("blocking removes follows in both directions in one transaction", async () => {
    const queries = [];
    const invalidations = [];
    const actions = createSocialActions({
      chainId: 4153,
      runTransaction: async (work) => work({
        query: async (sql, values) => {
          queries.push({ sql, values });
          return { rowCount: 1 };
        },
      }),
      onBlock: (...addresses) => invalidations.push(addresses),
    });
    expect(await actions.setBlock(alice, bob, true)).toEqual({ blocked: true });
    expect(queries.map(({ sql }) => sql)).toEqual([
      expect.stringContaining("INSERT INTO blocks"),
      expect.stringContaining("DELETE FROM follows"),
    ]);
    expect(queries[1].values).toEqual([4153, alice, bob]);
    expect(invalidations).toEqual([[alice, bob]]);
  });

  test("a report cannot attach another trader's trade", async () => {
    const queries = [];
    const actions = createSocialActions({
      chainId: 4153,
      query: async (sql) => {
        queries.push(sql);
        return { rows: [{ trader_address: alice }] };
      },
    });
    await expect(actions.report(alice, {
      subjectAddress: bob,
      reason: "spam",
      tradeId: "trade-1",
    })).rejects.toMatchObject({ status: 400 });
    expect(queries).toHaveLength(1);
  });
});

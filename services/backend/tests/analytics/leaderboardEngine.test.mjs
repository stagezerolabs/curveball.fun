import { describe, expect, test } from "bun:test";

import { evaluateLeaderboards } from "../../src/analytics/leaderboardEngine.mjs";
import {
  AS_OF,
  CREATOR,
  DAY,
  E,
  engineInput,
  eventFactory,
  market,
} from "./ledgerFixtures.mjs";

const milli = (n) => (BigInt(n) * E) / 1000n;
const MARKETS = ["0xa", "0xb", "0xc", "0xd"].map((token) => market(token));

// Five small non-qualifying wallets per market so the depth gate passes.
function crowd(f, tokens = ["0xa", "0xb", "0xc", "0xd"]) {
  for (const token of tokens) {
    for (let i = 0; i < 5; i++) {
      f.buy(`0xcrowd${i}`, token, 1000n, milli(1) / 10n, {
        at: AS_OF - 30 * DAY - 100 + i,
      });
    }
  }
}

// 6 profitable round trips (12 trades) over 3 markets and 6 days.
function profitableTrader(f, wallet, opts = {}) {
  const start = opts.start ?? AS_OF - 20 * DAY;
  const cost = opts.cost ?? milli(50);
  const proceeds = opts.proceeds ?? [60, 60, 60, 60, 60, 60].map(milli);
  const tokens = opts.tokens ?? ["0xa", "0xb", "0xc", "0xa", "0xb", "0xc"];
  for (let i = 0; i < tokens.length; i++) {
    const at = start + i * DAY;
    f.buy(wallet, tokens[i], 1000n, cost, {
      at,
      antiSnipeTax: opts.antiSnipeTax ?? 0n,
    });
    f.sell(wallet, tokens[i], 1000n, proceeds[i], { at: at + 60 });
  }
}

const addresses = (board) => board.items.map((row) => row.address);
const evaluationOf = (result, address) =>
  result.evaluations.find((e) => e.address === address);

describe("evaluateLeaderboards", () => {
  test("a profitable established trader ranks on Track record", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xgood");
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    const board = result.categories.consistent;
    expect(board.status).toBe("ranked");
    expect(addresses(board)).toEqual(["0xgood"]);
    expect(board.items[0].rank).toBe(1);
    // 0.06 WETH realized, 12 qualifying trades: floor(0.06e18 * 12 / 20).
    expect(board.items[0].score).toBe(36000000000000000n);
    expect(board.items[0].metrics.netPnlWei).toBe("60000000000000000");
    expect(board.items[0].metrics.confidence).toBe("developing");
  });

  test("wash round-trip does not rank", () => {
    const f = eventFactory();
    crowd(f);
    const start = AS_OF - 20 * DAY;
    for (let i = 0; i < 12; i++) {
      const token = ["0xa", "0xb", "0xc"][i % 3];
      const at = start + i * (DAY / 2);
      f.buy("0xwash", token, 1000n, milli(50), { at });
      // Fee and tax leak on every leg.
      f.sell("0xwash", token, 1000n, milli(50) - milli(50) * 150n / 10000n, {
        at: at + 1,
      });
    }
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    const wash = evaluationOf(result, "0xwash");
    expect(BigInt(wash.metrics.realizedPnlWei) < 0n).toBe(true);
    expect(addresses(result.categories.consistent)).not.toContain("0xwash");
    expect(result.categories.consistent.status).toBe("no_qualifiers");
  });

  test("thin-market pump does not rank", () => {
    const f = eventFactory();
    const thin = market("0xthin", {
      vQ: (13n * E) / 10n,
      vT: 769230769230769230769230770n / 3n, // price roughly tripled
    });
    f.buy("0xother", "0xthin", 1000n, milli(1));
    f.buy("0xpump", "0xthin", 100000000n * E, milli(100));
    const result = evaluateLeaderboards(engineInput(f, [thin]));
    const pump = evaluationOf(result, "0xpump");
    expect(pump.perMarket[0].thinMarket).toBe(true);
    expect(pump.metrics.openValueWei).toBe("0");
    expect(BigInt(pump.metrics.scoredPnlWei) <= 0n).toBe(true);
    for (const board of Object.values(result.categories)) {
      expect(addresses(board)).not.toContain("0xpump");
    }
  });

  test("an unrealized gain alone in a deep market scores nothing", () => {
    const f = eventFactory();
    crowd(f, ["0xa"]);
    f.buy("0xpaper", "0xa", 100000000n * E, milli(100), { at: AS_OF - DAY });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    const paper = evaluationOf(result, "0xpaper");
    expect(BigInt(paper.metrics.openValueWei) > milli(100)).toBe(true);
    expect(paper.metrics.realizedPnlWei).toBe("0");
    expect(paper.metrics.scoredPnlWei).toBe("0");
    for (const board of Object.values(result.categories)) {
      expect(addresses(board)).not.toContain("0xpaper");
    }
  });

  test("creator-only wallet is excluded", () => {
    const f = eventFactory();
    crowd(f);
    const own = market("0xown", { creator: CREATOR });
    for (let i = 0; i < 6; i++) {
      f.buy(CREATOR, "0xown", 1000n, milli(50), { at: AS_OF - 20 * DAY + i * DAY });
      f.sell(CREATOR, "0xown", 1000n, milli(90), { at: AS_OF - 20 * DAY + i * DAY + 60 });
    }
    f.buy("0xsmall", "0xa", 1000n, milli(10), { at: AS_OF - DAY });
    const result = evaluateLeaderboards(engineInput(f, [...MARKETS, own]));
    for (const board of Object.values(result.categories)) {
      expect(addresses(board)).not.toContain(CREATOR);
      expect(board.watching.map((row) => row.address)).not.toContain(CREATOR);
      const counted = board.progress.reduce((sum, p) => sum + p.walletCount, 0);
      expect(counted).toBe(1);
    }
  });

  test("transfer-out realizes the loss", () => {
    const build = (withTransfer) => {
      const f = eventFactory();
      crowd(f);
      profitableTrader(f, "0xgood");
      f.buy("0xgood", "0xd", 1000n, milli(20), { at: AS_OF - 12 * DAY });
      if (withTransfer) f.transfer("0xgood", "0xelsewhere", "0xd", 1000n, { at: AS_OF - 11 * DAY });
      const stale = MARKETS.map((m) =>
        m.token === "0xd" ? { ...m, latestTradeAt: AS_OF - 9 * DAY } : m,
      );
      return evaluationOf(evaluateLeaderboards(engineInput(f, stale)), "0xgood");
    };
    const kept = build(false);
    const moved = build(true);
    expect(BigInt(kept.metrics.netPnlWei) - BigInt(moved.metrics.netPnlWei)).toBe(
      milli(20),
    );
    expect(moved.metrics.transferOutCount).toBe(1);
    expect(moved.metrics.staleMarkCount).toBe(0);
  });

  test("stale price never yields -100%", () => {
    const f = eventFactory();
    f.buy("0xstale", "0xs", 1000n, milli(50), { at: AS_OF - 9 * DAY });
    const stale = market("0xs", { latestTradeAt: AS_OF - 8 * DAY });
    const metrics = evaluationOf(
      evaluateLeaderboards(engineInput(f, [stale])),
      "0xstale",
    ).metrics;
    expect(metrics.netPnlWei).toBe("0");
    expect(metrics.returnBps).toBe(0);
    expect(metrics.staleMarkCount).toBe(1);
    expect(metrics.openValueWei).toBe("0");
    expect(metrics.peakCapitalWei).toBe(milli(50).toString());
  });

  test("empty board returns no_qualifiers with Watching sorted by activity", () => {
    const f = eventFactory();
    crowd(f);
    for (let i = 0; i < 6; i++) f.buy("0xsix", "0xa", 1000n, milli(6), { at: AS_OF - 5 * DAY + i });
    for (let i = 0; i < 3; i++) f.buy("0xthree", "0xb", 1000n, milli(6), { at: AS_OF - 4 * DAY + i });
    f.buy("0xone", "0xc", 1000n, milli(4), { at: AS_OF - 3 * DAY });
    f.sell("0xone", "0xc", 1000n, milli(50), { at: AS_OF - 3 * DAY + 1 });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    const board = result.categories.consistent;
    expect(board.status).toBe("no_qualifiers");
    expect(board.items).toEqual([]);
    expect(board.watching.map((row) => row.address)).toEqual([
      "0xsix",
      "0xthree",
      "0xone",
    ]);
    for (const row of board.watching) {
      expect(row.rank).toBeNull();
      expect(row.provisional).toBe(true);
      expect(row).not.toHaveProperty("returnBps");
      expect(row).not.toHaveProperty("netPnlWei");
      expect(JSON.stringify(row)).not.toMatch(/pnl|return/i);
    }
    expect(board.watching[0].qualifyingTradeCount).toBe(6);
    expect(board.progress.reduce((sum, p) => sum + p.walletCount, 0)).toBe(3);
    expect(board.rules.minQualifyingTrades).toBe(10);
  });

  test("sum of per-market P&L equals wallet P&L", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xgood");
    f.buy("0xgood", "0xd", 100000000n * E, milli(100), { at: AS_OF - DAY });
    f.buy("0xgood", "0xa", 1000n, milli(30), { at: AS_OF - DAY + 1 });
    f.transfer("0xgood", "0xelsewhere", "0xa", 400n, { at: AS_OF - DAY + 2 });
    f.buy("0xmixed", "0xb", 100000000n * E, milli(80), { at: AS_OF - DAY + 10 });
    f.sell("0xmixed", "0xb", 50000000n * E, milli(20), { at: AS_OF - DAY + 15 });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    expect(result.evaluations.length).toBeGreaterThan(5);
    for (const evaluation of result.evaluations) {
      let net = 0n;
      let scored = 0n;
      for (const row of evaluation.perMarket) {
        net += BigInt(row.realizedPnlWei) + BigInt(row.unrealizedPnlWei);
        scored += BigInt(row.scoredPnlWei);
      }
      expect(net).toBe(BigInt(evaluation.metrics.netPnlWei));
      expect(scored).toBe(BigInt(evaluation.metrics.scoredPnlWei));
    }
    const good = evaluationOf(result, "0xgood").metrics;
    // Paper upside is capped at realized profit.
    expect(BigInt(good.scoredPnlWei) <= 2n * BigInt(good.realizedPnlWei)).toBe(true);
  });

  test("Track record and Emerging are disjoint", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xold");
    profitableTrader(f, "0xfresh", { start: AS_OF - 8 * DAY });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    expect(addresses(result.categories.consistent)).toEqual(["0xold"]);
    expect(addresses(result.categories.new)).toEqual(["0xfresh"]);
  });

  test("protocol accounts never appear", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xtreasury");
    const result = evaluateLeaderboards(
      engineInput(f, MARKETS, { protocolAccounts: ["0xlaunchpad", "0xtreasury"] }),
    );
    for (const board of Object.values(result.categories)) {
      expect(addresses(board)).not.toContain("0xtreasury");
      expect(board.watching.map((row) => row.address)).not.toContain("0xtreasury");
    }
    expect(evaluationOf(result, "0xtreasury")).toBeUndefined();
  });

  test("peak capital floors", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xunder", {
      cost: milli(49),
      proceeds: [59, 59, 59, 59, 59, 59].map(milli),
    });
    profitableTrader(f, "0xsmallnew", {
      start: AS_OF - 8 * DAY,
      cost: milli(20),
      proceeds: [25, 25, 25, 25, 25, 25].map(milli),
    });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    expect(addresses(result.categories.consistent)).not.toContain("0xunder");
    expect(addresses(result.categories.new)).toContain("0xsmallnew");
  });

  test("launch-window-heavy wallet is excluded from Track record", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xsniper", { antiSnipeTax: 1n });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    expect(evaluationOf(result, "0xsniper").metrics.launchWindowShareBps).toBe(10000);
    expect(addresses(result.categories.consistent)).not.toContain("0xsniper");
  });

  test("a wallet with 70% of positive P&L from one market is excluded from Track record", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xlucky", {
      proceeds: [85, 57, 57, 85, 58, 58].map(milli),
    });
    const result = evaluateLeaderboards(engineInput(f, MARKETS));
    // 0.07 of 0.10 positive P&L from 0xa.
    expect(evaluationOf(result, "0xlucky").metrics.singleMarketShareBps).toBe(7000);
    expect(addresses(result.categories.consistent)).not.toContain("0xlucky");
  });

  test("followers ranks by eligible followers and is labelled social", () => {
    const f = eventFactory();
    crowd(f);
    profitableTrader(f, "0xstar", { start: AS_OF - 20 * DAY });
    profitableTrader(f, "0xfan", { start: AS_OF - 25 * DAY });
    const result = evaluateLeaderboards(
      engineInput(f, MARKETS, {
        follows: [
          { follower: "0xfan", followed: "0xstar" },
          { follower: "0xcrowd0", followed: "0xstar" },
        ],
      }),
    );
    const board = result.categories.followers;
    expect(addresses(board)).toEqual(["0xstar"]);
    // 0xcrowd0 has no qualifying volume, so only 0xfan counts.
    expect(board.items[0].score).toBe(1n);
  });
});

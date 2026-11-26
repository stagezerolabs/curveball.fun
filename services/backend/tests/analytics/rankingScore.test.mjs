import { describe, expect, test } from "bun:test";

import {
  compareEntities,
  confidenceLabel,
  floorDiv,
  returnBps,
  scoredPnl,
  shrunkScore,
} from "../../src/analytics/rankingScore.mjs";

const E = 10n ** 18n;
const milli = (n) => (BigInt(n) * E) / 1000n;

describe("ranking score", () => {
  test("shrunkScore shrinks thin samples and floors toward negative infinity", () => {
    expect(shrunkScore(10n ** 17n, 10n)).toBe(55555555555555555n);
    expect(shrunkScore(10n ** 17n, 40n)).toBe(83333333333333333n);
    expect(shrunkScore(-(10n ** 17n), 10n)).toBe(-55555555555555556n);
    expect(shrunkScore(10n ** 17n, 0n)).toBe(0n);
    expect(floorDiv(-7n, 2n)).toBe(-4n);
  });

  test("scoredPnl caps open-position upside at realized profit", () => {
    expect(scoredPnl(milli(10), milli(50))).toBe(milli(20));
    expect(scoredPnl(0n, milli(50))).toBe(0n);
    expect(scoredPnl(milli(30), -milli(10))).toBe(milli(20));
    expect(scoredPnl(-milli(10), milli(50))).toBe(-milli(10));
  });

  test("a small-base wallet cannot outrank a larger profit", () => {
    const entity = (address, pnl, n) => ({
      address,
      score: shrunkScore(pnl, n),
      realizedPnl: pnl,
      qualifyingTradeCount: Number(n),
      firstTradeAt: 0,
    });
    const smallBase = entity("0xa", (8n * E) / 10000n, 40n);
    const larger = entity("0xb", milli(10), 10n);
    expect(returnBps((8n * E) / 10000n, milli(1))).toBe(8000n);
    expect(returnBps(milli(10), milli(50))).toBe(2000n);
    expect([smallBase, larger].sort(compareEntities).map((e) => e.address)).toEqual(
      ["0xb", "0xa"],
    );
  });

  test("tie-break order is deterministic", () => {
    const base = {
      score: 5n,
      realizedPnl: 5n,
      qualifyingTradeCount: 10,
      firstTradeAt: 100,
    };
    const rows = [
      { ...base, address: "0xd" },
      { ...base, address: "0xc" },
      { ...base, address: "0xe", firstTradeAt: 50 },
      { ...base, address: "0xf", qualifyingTradeCount: 11 },
      { ...base, address: "0xg", realizedPnl: 6n },
      { ...base, address: "0xh", score: 6n },
    ];
    expect(rows.sort(compareEntities).map((r) => r.address)).toEqual([
      "0xh",
      "0xg",
      "0xf",
      "0xe",
      "0xc",
      "0xd",
    ]);
  });

  test("confidence labels and zero capital return", () => {
    expect(confidenceLabel(25)).toBe("established");
    expect(confidenceLabel(10)).toBe("developing");
    expect(confidenceLabel(9)).toBe("new");
    expect(returnBps(5n, 0n)).toBeNull();
  });
});

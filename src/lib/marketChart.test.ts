import { describe, expect, test } from "bun:test";
import {
  buildBlockRanges,
  buildCandles,
  parseCreatedBlock,
  tradeLogToPoint,
  withRetry,
} from "./marketChart";

describe("buildCandles", () => {
  test("groups trades into OHLC candles and sums volume", () => {
    expect(
      buildCandles(
        [
          { timestamp: 61, price: 2, volume: 3 },
          { timestamp: 80, price: 4, volume: 5 },
          { timestamp: 119, price: 1, volume: 7 },
          { timestamp: 121, price: 3, volume: 11 },
        ],
        60,
      ),
    ).toEqual([
      { time: 60, open: 2, high: 4, low: 1, close: 1, volume: 15 },
      { time: 120, open: 3, high: 3, low: 3, close: 3, volume: 11 },
    ]);
  });

  test("drops invalid trades and returns candles in chronological order", () => {
    expect(
      buildCandles(
        [
          { timestamp: 180, price: 3, volume: 1 },
          { timestamp: 60, price: 1, volume: 2 },
          { timestamp: 120, price: Number.NaN, volume: 4 },
          { timestamp: 90, price: 0, volume: 2 },
        ],
        60,
      ),
    ).toEqual([
      { time: 60, open: 1, high: 1, low: 1, close: 1, volume: 2 },
      { time: 180, open: 3, high: 3, low: 3, close: 3, volume: 1 },
    ]);
  });
});

describe("buildBlockRanges", () => {
  test("creates inclusive bounded ranges", () => {
    expect(buildBlockRanges(10n, 20n, 5n)).toEqual([
      { fromBlock: 10n, toBlock: 14n },
      { fromBlock: 15n, toBlock: 19n },
      { fromBlock: 20n, toBlock: 20n },
    ]);
  });

  test("returns no ranges when already caught up", () => {
    expect(buildBlockRanges(21n, 20n, 5n)).toEqual([]);
  });
});

describe("chart RPC helpers", () => {
  test("retries transient failures", async () => {
    let attempts = 0;
    const value = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary");
        return "ok";
      },
      3,
      0,
    );
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("decodes both v1 and v2 trade volume fields", () => {
    const reserves = { vQAfter: 4_000000000000000000n, vTAfter: 2_000000000000000000n };
    expect(tradeLogToPoint({ ...reserves, quoteAmount: 1_000000000000000000n }, 100)).toEqual({
      timestamp: 100,
      price: 2,
      volume: 1,
    });
    expect(tradeLogToPoint({ ...reserves, grossCurveQuote: 3_000000000000000000n }, 100)).toEqual({
      timestamp: 100,
      price: 2,
      volume: 3,
    });
  });

  test("keeps created blocks JSON-safe and parses them at the boundary", () => {
    const serialized = JSON.stringify({ createdBlock: "56237968" });
    expect(serialized).toContain("56237968");
    expect(parseCreatedBlock("56237968", 10n)).toBe(56237968n);
    expect(parseCreatedBlock(undefined, 10n)).toBe(10n);
  });
});

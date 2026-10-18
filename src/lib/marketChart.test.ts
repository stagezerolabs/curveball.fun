import { describe, expect, test } from "bun:test";
import {
  buildBlockRanges,
  buildCandles,
  parseCreatedBlock,
  tradeLogToPoint,
  tradeLogToActivity,
  toMarketCapPoints,
} from "./marketChart";

test("converts trade history into market-cap history using fixed supply", () => {
  expect(toMarketCapPoints(
    [{ timestamp: 60, price: 0.5, volume: 2 }],
    1,
    1_000,
  )).toEqual([{ timestamp: 60, price: 500, volume: 2 }]);
});

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
  test("decodes trade volume from the gross curve quote", () => {
    const reserves = { vQAfter: 4_000000000000000000n, vTAfter: 2_000000000000000000n };
    expect(tradeLogToPoint({ ...reserves, grossCurveQuote: 3_000000000000000000n }, 100)).toEqual({
      timestamp: 100,
      price: 2,
      volume: 3,
    });
  });

  test("keeps the actual trader quote and event identity for buy and sell rows", () => {
    const trader = "0x0000000000000000000000000000000000000001";
    const transactionHash = `0x${"a".repeat(64)}` as `0x${string}`;
    const log = {
      args: { trader, isBuy: false, tokenAmount: 2_000000000000000000n,
        grossCurveQuote: 3_000000000000000000n, netTraderQuote: 2_700000000000000000n },
      blockNumber: 42n,
      logIndex: 1,
      transactionHash,
    };
    expect(tradeLogToActivity(log, 100)).toEqual({
      trader, participantRole: "trader", venue: "curve", isBuy: false, tokenAmount: 2_000000000000000000n,
      quoteAmount: 2_700000000000000000n, timestamp: 100,
      blockNumber: 42n, logIndex: 1, transactionHash,
    });
    expect(tradeLogToActivity({ ...log, args: { ...log.args, trader: undefined } }, 100)).toBeNull();
  });

  test("keeps created blocks JSON-safe and parses them at the boundary", () => {
    const serialized = JSON.stringify({ createdBlock: "56237968" });
    expect(serialized).toContain("56237968");
    expect(parseCreatedBlock("56237968", 10n)).toBe(56237968n);
    expect(parseCreatedBlock(undefined, 10n)).toBe(10n);
  });
});

import { expect, test } from "bun:test";
import type { Address, Hash } from "viem";
import { summarizeMarketPreviewStats, type MarketTradeSample } from "./marketPreviewStats";

const token = "0x0000000000000000000000000000000000000001" as Address;
const traderA = "0x000000000000000000000000000000000000000a" as Address;
const traderB = "0x000000000000000000000000000000000000000b" as Address;
const hashA = `0x${"a".repeat(64)}` as Hash;
const hashB = `0x${"b".repeat(64)}` as Hash;

test("summarizes decision metrics from real trade samples", () => {
  const now = 100_000;
  const samples: MarketTradeSample[] = [
    { token, trader: traderA, transactionHash: hashA, eventId: "1:0", timestamp: now - 90_000, price: 1, volume: 10 },
    { token, trader: traderA, transactionHash: hashB, eventId: "2:0", timestamp: now - 20_000, price: 1.5, volume: 2 },
    { token, trader: traderB, transactionHash: hashB, eventId: "2:1", timestamp: now - 1_000, price: 1.8, volume: 3 },
  ];

  const stats = summarizeMarketPreviewStats([{ address: token, price: 2, marketCap: 2_000 }], samples, now)[token.toLowerCase()];

  expect(stats.athMarketCap).toBe(2_000);
  expect(stats.transactions).toBe(2);
  expect(stats.traders).toBe(2);
  expect(stats.volume24h).toBe(5);
  expect(stats.change1h).toBeCloseTo(33.333, 2);
  expect(stats.change6h).toBe(100);
  expect(stats.change24h).toBe(100);
});

test("returns explicit empty-market values without inventing performance", () => {
  const stats = summarizeMarketPreviewStats([{ address: token, price: 0.25, marketCap: 250 }], [], 100_000)[token.toLowerCase()];

  expect(stats).toEqual({
    athMarketCap: 250,
    transactions: 0,
    traders: 0,
    volume24h: 0,
    change1h: null,
    change6h: null,
    change24h: null,
  });
});

import { expect, test } from "bun:test";
import type { Address, Hash } from "viem";
import type { MarketTradeSample } from "../lib/marketPreviewStats";
import { buildNowMoments } from "./nowPulse";

const now = 1_000_000;
const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const tokens = Array.from({ length: 20 }, (_, i) => ({
  address: address(i + 1),
  name: `Coin ${i + 1}`,
  symbol: `C${i + 1}`,
}));
let id = 0;
const trade = (
  token: number,
  isBuy: boolean,
  quote: bigint,
  secondsAgo: number,
  trader = 100,
): MarketTradeSample => ({
  token: address(token),
  trader: address(trader),
  transactionHash: hash(++id),
  eventId: String(id),
  timestamp: now - secondsAgo,
  price: 1,
  volume: 1,
  isBuy,
  quoteWei: quote,
});

test("keeps only net-buying markets and ranks them by net inflow", () => {
  const moments = buildNowMoments(
    [
      trade(1, true, 5n, 60),
      trade(1, false, 1n, 30),
      trade(2, true, 10n, 60),
      trade(3, true, 2n, 60),
      trade(3, false, 9n, 30),
      trade(4, true, 3n, 60),
      trade(4, false, 3n, 30),
    ],
    tokens,
    "1h",
    now,
  );
  expect(moments.map((moment) => moment.tokenSymbol)).toEqual(["C2", "C1"]);
  expect(moments[1]).toMatchObject({
    tradeCount: 2,
    buyCount: 1,
    sellCount: 1,
    buyQuoteWei: "5",
    sellQuoteWei: "1",
    netQuoteWei: "4",
    reason: "net_buying",
    followedTraderCount: 0,
  });
});

test("only counts trades inside the selected window", () => {
  const samples = [trade(1, true, 5n, 30), trade(1, false, 20n, 7_200)];
  expect(buildNowMoments(samples, tokens, "1h", now)[0]?.netQuoteWei).toBe("5");
  expect(buildNowMoments(samples, tokens, "24h", now)).toEqual([]);
});

test("reports distinct wallets, the observed span and the latest buy", () => {
  const first = trade(1, true, 1n, 600, 7);
  const latestBuy = trade(1, true, 1n, 120, 8);
  const sell = trade(1, false, 1n, 60, 7);
  const [moment] = buildNowMoments([first, latestBuy, sell], tokens, "1h", now);
  expect(moment.distinctWalletCount).toBe(2);
  expect(moment.firstAt).toBe(new Date((now - 600) * 1_000).toISOString());
  expect(moment.latestAt).toBe(new Date((now - 60) * 1_000).toISOString());
  expect(moment.sampleTransactionHash).toBe(latestBuy.transactionHash!);
});

test("breaks ties by recency, caps the list and ignores unknown markets", () => {
  const samples = tokens.map((_, i) => trade(i + 1, true, 1n, 1_000 - i));
  samples.push(trade(999, true, 100n, 10));
  const moments = buildNowMoments(samples, tokens, "1h", now);
  expect(moments).toHaveLength(12);
  expect(moments[0].tokenSymbol).toBe("C20");
});

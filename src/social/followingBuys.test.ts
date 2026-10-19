import { expect, test } from "bun:test";
import type { Address } from "viem";
import type { MarketTradeSample } from "../lib/marketPreviewStats";
import { buildFollowingBuys } from "./followingBuys";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const tokens = [1, 2].map((n) => ({ address: address(n), name: `Coin ${n}`, symbol: `C${n}` }));
const trade = (token: number, trader: number, isBuy: boolean, quoteWei: bigint): MarketTradeSample => ({
  token: address(token), trader: address(trader), eventId: `${token}:${trader}:${quoteWei}`,
  timestamp: 1, price: 1, volume: 1, isBuy, quoteWei,
});

test("groups buys by market, most buyers first, biggest buyer first", () => {
  const buys = buildFollowingBuys([
    trade(1, 10, true, 9n),
    trade(2, 10, true, 1n), trade(2, 11, true, 3n), trade(2, 11, true, 2n), trade(2, 10, false, 50n),
  ], tokens);
  expect(buys.map((buy) => buy.tokenSymbol)).toEqual(["C2", "C1"]);
  expect(buys[0].boughtQuoteWei).toBe("6");
  expect(buys[0].buyers.map((buyer) => buyer.address)).toEqual([address(11), address(10)]);
});

test("narrows to followed wallets when given", () => {
  const buys = buildFollowingBuys([trade(1, 10, true, 1n), trade(2, 11, true, 1n)], tokens, new Set([address(11)]));
  expect(buys.map((buy) => buy.tokenSymbol)).toEqual(["C2"]);
});

import { expect, test } from "bun:test";
import type { Address } from "viem";
import type { MarketTradeSample } from "../lib/marketPreviewStats";
import { buildFollowingActivity } from "./followingActivity";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const tokens = [1, 2].map((n) => ({
  address: address(n),
  name: `Coin ${n}`,
  symbol: `C${n}`,
  creator: address(n + 100),
  createdAt: new Date(n * 1000).toISOString(),
}));
const trade = (
  token: number,
  trader: number,
  isBuy: boolean,
  quoteWei: bigint,
  timestamp = 1,
): MarketTradeSample => ({
  token: address(token),
  trader: address(trader),
  eventId: `${token}:${trader}:${quoteWei}:${timestamp}`,
  timestamp,
  price: 1,
  volume: 1,
  isBuy,
  quoteWei,
});

test("without follows only buys count, newest activity first", () => {
  const activity = buildFollowingActivity(
    [
      trade(1, 10, true, 9n, 5),
      trade(2, 10, true, 1n, 2),
      trade(2, 11, true, 3n, 1),
      trade(2, 11, true, 2n, 1),
      trade(2, 10, false, 50n, 9),
    ],
    tokens,
  );
  expect(activity.map((market) => market.tokenSymbol)).toEqual(["C1", "C2"]);
  expect(activity[1].boughtQuoteWei).toBe("6");
  expect(activity[1].soldQuoteWei).toBe("0");
  expect(activity[1].actors.map((actor) => actor.address)).toEqual([
    address(11),
    address(10),
  ]);
});

test("followed wallets show launches, buys and sells with per-wallet totals", () => {
  const activity = buildFollowingActivity(
    [
      trade(1, 10, true, 4n, 3),
      trade(1, 10, true, 2n, 4),
      trade(1, 11, false, 1n, 6),
    ],
    tokens,
    new Set([address(10), address(11), address(101)]),
  );
  const market = activity.find((entry) => entry.tokenSymbol === "C1")!;
  expect(market.boughtQuoteWei).toBe("6");
  expect(market.soldQuoteWei).toBe("1");
  expect(market.actors).toEqual([
    { address: address(10), action: "buy", amountQuoteWei: "6" },
    { address: address(11), action: "sell", amountQuoteWei: "1" },
    { address: address(101), action: "launch", amountQuoteWei: "0" },
  ]);
});

test("narrows to followed wallets when given", () => {
  const activity = buildFollowingActivity(
    [trade(1, 10, true, 1n), trade(2, 11, true, 1n)],
    tokens,
    new Set([address(11)]),
  );
  expect(activity.map((market) => market.tokenSymbol)).toEqual(["C2"]);
});

import { expect, test } from "bun:test";
import { confirmedTradeStateUpdate } from "./useStore.js";

const supply = 1_000_000_000_000_000_000_000n;
const curveSupply = 1_000_000_000_000_000_000_000n;
const confirmedTrade = {
  quotedOutput: 1_000_000_000_000_000_000n,
  marketState: {
    sold: 250_000_000_000_000_000_000n,
    virtualQuote: 2_000_000_000_000_000_000n,
    virtualToken: 4_000_000_000_000_000_000n,
  },
};

test("a confirmed trade updates every cached copy of the market immediately", () => {
  const address = "0x6D4f1d95c636F44CDeA5D15bf88CbAe5c60BD2A2";
  const creator = "0x5CC42e772F67089b4670eec4dcD904be2F2D511c";
  const key = address.toLowerCase();
  const creatorKey = creator.toLowerCase();
  const token = {
    address,
    creator,
    factory: "0x1111111111111111111111111111111111111111",
    name: "CASH",
    symbol: "CASH",
    progress: 10,
    price: 0.1,
    marketCap: 100,
    supply: supply.toString(),
    curveSupply: curveSupply.toString(),
    pending: false,
  };

  const state = confirmedTradeStateUpdate({
    amount: "1",
    tokens: [token],
    marketsFetchedAt: 123,
    tokenCache: { [key]: token },
    tokenFetchedAt: { [key]: 123 },
    creatorTokens: { [creatorKey]: [token] },
    creatorFetchedAt: { [creatorKey]: 123 },
  }, "buy", token, confirmedTrade);
  for (const cached of [
    state.tokenCache[key],
    state.tokens[0],
    state.creatorTokens[creatorKey][0],
  ]) {
    expect(cached.progress).toBe(25);
    expect(cached.price).toBe(0.5);
    expect(cached.marketCap).toBe(500);
  }
});

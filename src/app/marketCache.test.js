import { expect, test } from "bun:test";
import { createdTokenCacheUpdate, rehydrateMarketCache } from "./useStore.js";
import { launchpadAddress } from "../lib/web3";

test("only configured factory markets rehydrate and are revalidated after page load", () => {
  const token = {
    address: "0x2114E56B6D3524022D0E4812F2523120C3BC94Aa",
    factory: launchpadAddress,
    name: "CASH",
  };
  const restored = rehydrateMarketCache(
    {
      tokens: [
        token,
        {
          address: "0x3333333333333333333333333333333333333333",
          factory: "0x4444444444444444444444444444444444444444",
        },
      ],
      marketsFetchedAt: Date.now(),
      tokenCache: {},
    },
    { tokens: [], marketsFetchedAt: 0, tokenCache: {}, loading: false },
  );

  expect(restored.tokens).toEqual([token]);
  expect(restored.marketsFetchedAt).toBe(0);
  expect(restored.loading).toBe(false);
});

test("a confirmed launch survives malformed saved creator tokens", () => {
  const creator = "0x5CC42e772F67089b4670eec4dcD904be2F2D511c";
  const token = {
    address: "0x6D4f1d95c636F44CDeA5D15bf88CbAe5c60BD2A2",
    creator,
    name: "CASH",
  };
  const creatorKey = creator.toLowerCase();
  const update = createdTokenCacheUpdate(
    {
      tokenCache: {},
      tokenFetchedAt: {},
      tokens: [],
      marketsFetchedAt: 0,
      creatorTokens: { [creatorKey]: [{ name: "old malformed token" }] },
      creatorFetchedAt: {},
    },
    token,
  );

  expect(update.tokenCache[token.address.toLowerCase()]).toEqual(token);
  expect(update.creatorTokens[creatorKey]).toEqual([token]);
});

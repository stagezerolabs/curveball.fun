import { expect, test } from "bun:test";
import {
  createdTokenCacheUpdate,
  rehydrateMarketCache,
  useStore,
} from "./useStore.js";
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

test("saved market lists and creator holdings never restore the hidden token", () => {
  const hidden = {
    address: "0xCe4b88c65E3C1F57Ba43c1F6A3536ae15D6aF299",
    factory: launchpadAddress,
    creator: "0x5CC42e772F67089b4670eec4dcD904be2F2D511c",
  };
  const visible = {
    ...hidden,
    address: "0x2114E56B6D3524022D0E4812F2523120C3BC94Aa",
  };
  const creatorKey = hidden.creator.toLowerCase();
  const hiddenKey = hidden.address.toLowerCase();
  const visibleKey = visible.address.toLowerCase();
  const restored = rehydrateMarketCache(
    {
      tokens: [hidden, visible],
      tokenCache: { [hiddenKey]: hidden, [visibleKey]: visible },
      tokenFetchedAt: { [hiddenKey]: 1, [visibleKey]: 1 },
      creatorTokens: { [creatorKey]: [hidden, visible] },
    },
    { tokens: [], tokenCache: {}, creatorTokens: {}, tokenFetchedAt: {} },
  );

  expect(restored.tokens).toEqual([visible]);
  expect(restored.tokenCache).toEqual({ [visibleKey]: visible });
  expect(restored.tokenFetchedAt).toEqual({ [visibleKey]: 1 });
  expect(restored.creatorTokens[creatorKey]).toEqual([visible]);
});

test("a hidden market cannot load through its direct address", async () => {
  const address = "0xCe4b88c65E3C1F57Ba43c1F6A3536ae15D6aF299";
  expect(await useStore.getState().loadToken({}, address)).toBeNull();
  expect(useStore.getState().tokenCache[address.toLowerCase()]).toBeUndefined();
});

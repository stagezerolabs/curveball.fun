import { expect, test } from "bun:test";
import { rehydrateMarketCache } from "./useStore.js";

test("saved markets display immediately but are revalidated after page load", () => {
  const token = { address: "0x2114E56B6D3524022D0E4812F2523120C3BC94Aa", name: "CASH" };
  const restored = rehydrateMarketCache(
    { tokens: [token], marketsFetchedAt: Date.now(), tokenCache: { [token.address.toLowerCase()]: token }, tokenFetchedAt: { [token.address.toLowerCase()]: Date.now() } },
    { tokens: [], marketsFetchedAt: 0, tokenCache: {}, loading: false },
  );

  expect(restored.tokens).toEqual([token]);
  expect(restored.marketsFetchedAt).toBe(0);
  expect(restored.tokenFetchedAt).toEqual({});
  expect(restored.loading).toBe(false);
});

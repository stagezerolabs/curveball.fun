import { expect, test } from "bun:test";
import { createCoinGeckoEthUsdSource, createEthUsdProvider } from "./ethUsd";

test("serves one fresh ETH/USD snapshot throughout the cache window", async () => {
  let now = 1_789_830_000_000;
  let upstreamUsd = 2_637.67;
  const provider = createEthUsdProvider({
    now: () => now,
    getEthUsd: async () => ({
      usd: upstreamUsd,
      lastUpdatedAt: 1_789_829_910,
    }),
  });

  expect(await provider.getRate()).toEqual({
    usd: 2_637.67,
    updatedAt: "2026-09-19T14:58:30.000Z",
    stale: false,
  });

  upstreamUsd = 2_700;
  now += 15_000;
  expect(await provider.getRate()).toEqual({
    usd: 2_637.67,
    updatedAt: "2026-09-19T14:58:30.000Z",
    stale: false,
  });
});

test("marks the last known rate stale when a refresh temporarily fails", async () => {
  let now = 1_789_830_000_000;
  let unavailable = false;
  const provider = createEthUsdProvider({
    now: () => now,
    getEthUsd: async () => {
      if (unavailable) throw new Error("upstream unavailable");
      return { usd: 2_637.67, lastUpdatedAt: 1_789_829_910 };
    },
  });

  await provider.getRate();
  unavailable = true;
  now += 31_000;

  expect(await provider.getRate()).toEqual({
    usd: 2_637.67,
    updatedAt: "2026-09-19T14:58:30.000Z",
    stale: true,
  });
});

test("reads a timestamped Ethereum price from CoinGecko", async () => {
  const source = createCoinGeckoEthUsdSource({
    apiKey: "demo-key",
    fetchFn: async () =>
      new Response(
        JSON.stringify({ ethereum: { usd: 2_637.67, last_updated_at: 1_789_829_910 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  expect(await source.getEthUsd()).toEqual({
    usd: 2_637.67,
    lastUpdatedAt: 1_789_829_910,
  });
});

test("uses Coinbase after a CoinGecko 403 and avoids retrying the forbidden endpoint", async () => {
  const requests: string[] = [];
  const fetchFn = async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("coingecko")) return new Response(null, { status: 403 });
    return Response.json({ price: "2637.67", time: "2026-09-19T14:58:30.000Z" });
  };
  const source = createCoinGeckoEthUsdSource({ fetchFn });

  expect(await createCoinGeckoEthUsdSource({ fetchFn }).getEthUsd()).toEqual({
    usd: 2_637.67,
    lastUpdatedAt: 1_789_829_910,
  });
  expect(await source.getEthUsd()).toEqual({ usd: 2_637.67, lastUpdatedAt: 1_789_829_910 });
  expect(requests.filter((url) => url.includes("coingecko"))).toHaveLength(1);
  expect(requests.filter((url) => url.includes("coinbase"))).toHaveLength(2);
});

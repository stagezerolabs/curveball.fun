export type EthUsdRate = Readonly<{
  usd: number;
  updatedAt: string;
  stale: boolean;
}>;

type EthUsdSource = Readonly<{
  getEthUsd: () => Promise<{
    usd: number;
    lastUpdatedAt: number;
  }>;
}>;

// Worker requests create separate source instances but share the same fetch implementation.
const forbiddenCoinGeckoFetchers = new WeakSet<Function>();

export function createCoinGeckoEthUsdSource({
  apiKey,
  fetchFn = fetch,
}: {
  apiKey?: string;
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} = {}): EthUsdSource {
  async function getCoinbaseEthUsd() {
    const response = await fetchFn("https://api.exchange.coinbase.com/products/ETH-USD/ticker", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Coinbase ETH/USD request failed with ${response.status}.`);
    }
    const payload = (await response.json()) as { price?: unknown; time?: unknown };
    const usd = typeof payload.price === "string" ? Number(payload.price) : NaN;
    const lastUpdatedAt =
      typeof payload.time === "string" ? Math.floor(Date.parse(payload.time) / 1_000) : NaN;
    if (!Number.isFinite(usd) || usd <= 0 || !Number.isSafeInteger(lastUpdatedAt) || lastUpdatedAt <= 0) {
      throw new Error("Coinbase returned an invalid ETH/USD payload.");
    }
    return { usd, lastUpdatedAt };
  }

  return Object.freeze({
    async getEthUsd() {
      if (forbiddenCoinGeckoFetchers.has(fetchFn)) return getCoinbaseEthUsd();
      const response = await fetchFn(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_last_updated_at=true",
        {
          headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined,
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.status === 403) {
        forbiddenCoinGeckoFetchers.add(fetchFn);
        return getCoinbaseEthUsd();
      }
      if (!response.ok) {
        throw new Error(`CoinGecko ETH/USD request failed with ${response.status}.`);
      }
      const payload = (await response.json()) as {
        ethereum?: { usd?: unknown; last_updated_at?: unknown };
      };
      const usd = payload.ethereum?.usd;
      const lastUpdatedAt = payload.ethereum?.last_updated_at;
      if (
        typeof usd !== "number" ||
        !Number.isFinite(usd) ||
        usd <= 0 ||
        typeof lastUpdatedAt !== "number" ||
        !Number.isSafeInteger(lastUpdatedAt) ||
        lastUpdatedAt <= 0
      ) {
        throw new Error("CoinGecko returned an invalid ETH/USD payload.");
      }
      return { usd, lastUpdatedAt };
    },
  });
}

export function createEthUsdProvider({
  getEthUsd,
  now = Date.now,
  freshForMs = 30_000,
  maxStaleMs = 10 * 60_000,
}: EthUsdSource & {
  now?: () => number;
  freshForMs?: number;
  maxStaleMs?: number;
}) {
  let cached: {
    rate: EthUsdRate;
    fetchedAt: number;
    refreshAfter: number;
  } | null = null;

  return Object.freeze({
    async getRate(): Promise<EthUsdRate> {
      const currentTime = now();
      if (cached && currentTime < cached.refreshAfter) {
        return cached.rate;
      }
      try {
        const response = await getEthUsd();
        if (!Number.isFinite(response.usd) || response.usd <= 0) {
          throw new Error("ETH/USD provider returned an invalid price.");
        }
        const updatedAt = new Date(response.lastUpdatedAt * 1_000);
        if (Number.isNaN(updatedAt.getTime())) {
          throw new Error("ETH/USD provider returned an invalid timestamp.");
        }
        const rate = Object.freeze({
          usd: response.usd,
          updatedAt: updatedAt.toISOString(),
          stale: false,
        });
        cached = {
          rate,
          fetchedAt: currentTime,
          refreshAfter: currentTime + freshForMs,
        };
        return rate;
      } catch (error) {
        if (cached && currentTime - cached.fetchedAt <= maxStaleMs) {
          cached = {
            ...cached,
            rate: Object.freeze({ ...cached.rate, stale: true }),
            refreshAfter: currentTime + freshForMs,
          };
          return cached.rate;
        }
        throw error;
      }
    },
  });
}

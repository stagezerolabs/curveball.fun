import type { EthUsdRate } from "./ethUsd";

type NativeValuation = Readonly<{
  price?: number | null;
  marketCap?: number | null;
  peakMarketCap?: number | null;
}>;

function convert(value: number | null | undefined, rate: EthUsdRate | null) {
  return value == null || !rate ? null : value * rate.usd;
}

export function addUsdValuation<T extends NativeValuation>(
  value: T,
  rate: EthUsdRate | null,
) {
  return {
    ...value,
    priceUsd: convert(value.price, rate),
    marketCapUsd: convert(value.marketCap, rate),
    peakMarketCapUsd: convert(value.peakMarketCap, rate),
    ethUsd: rate?.usd ?? null,
    usdUpdatedAt: rate?.updatedAt ?? null,
    usdStale: rate?.stale ?? false,
  };
}

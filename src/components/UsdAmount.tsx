import { useSyncExternalStore } from "react";

const COINGECKO_ETH_USD_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const REFRESH_INTERVAL_MS = 60_000;

let ethUsdPrice: number | null = null;
let activeRequest: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

async function refreshEthUsdPrice() {
  if (activeRequest) return activeRequest;
  activeRequest = fetch(COINGECKO_ETH_USD_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`CoinGecko returned ${response.status}.`);
      const data = (await response.json()) as { ethereum?: { usd?: number } };
      const nextPrice = data.ethereum?.usd;
      if (typeof nextPrice !== "number" || !Number.isFinite(nextPrice) || nextPrice <= 0) {
        throw new Error("CoinGecko returned an invalid ETH/USD price.");
      }
      ethUsdPrice = nextPrice;
      listeners.forEach((listener) => listener());
    })
    .catch(() => {
      // Keep the last valid price and retry on the next refresh.
    })
    .finally(() => {
      activeRequest = null;
    });
  return activeRequest;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshEthUsdPrice();
    refreshTimer = setInterval(() => void refreshEthUsdPrice(), REFRESH_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };
}

function getEthUsdPrice() {
  return ethUsdPrice;
}

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.00000001) return "<$0.00000001";
  const maximumFractionDigits = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : absolute >= 0.0001 ? 6 : 8;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

export function UsdAmount({ weth, suffix = "" }: { weth?: number | null; suffix?: string }) {
  const usdPerEth = useSyncExternalStore(subscribe, getEthUsdPrice, getEthUsdPrice);
  if (weth == null || usdPerEth == null) return <>—</>;
  return <>{formatUsd(weth * usdPerEth)}{suffix}</>;
}

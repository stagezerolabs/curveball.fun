import { useQuery } from "@tanstack/react-query";
import { formatEther, type Address } from "viem";
import type { CurveTapeDisplay } from "../components/MarketTape";
import { formatEthAmount } from "./format.js";
import { activeChainId } from "./web3";
import { fetchMarketTapeStats, type MarketTapeStats } from "../markets/api";
import { socialApiBaseUrl } from "../social/api";

// Temporary tape source, pinned to deployments/11155931/smoke.json.
const SMOKE_CHAIN_ID = 11_155_931;
const smokeTokenAddress =
  "0xe4EB285D7f496005dcfbFF0259071f7b2eb39C05" satisfies Address;

function formatTokenAmount(wei: string) {
  const amount = Number(formatEther(BigInt(wei)));
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1_000 ? 1 : 2,
  }).format(amount);
}

function displayStats(stats: MarketTapeStats): CurveTapeDisplay {
  return {
    volume24h: `${formatEthAmount(Number(formatEther(BigInt(stats.volume24hWei))))} WETH`,
    bought24h: formatTokenAmount(stats.bought24hWei),
    burnedTotal: formatTokenAmount(stats.burnedTotalWei),
  };
}

export function useCurveTapeStats() {
  const query = useQuery({
    queryKey: ["market-tape", activeChainId, smokeTokenAddress],
    queryFn: ({ signal }) => fetchMarketTapeStats(smokeTokenAddress, signal),
    enabled: activeChainId === SMOKE_CHAIN_ID && Boolean(socialApiBaseUrl),
    staleTime: 5 * 60_000,
    refetchInterval: false,
    retry: 1,
  });
  return query.data ? displayStats(query.data) : undefined;
}

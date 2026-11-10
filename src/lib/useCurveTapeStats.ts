import { useQuery } from "@tanstack/react-query";
import { formatEther, zeroAddress } from "viem";
import { useReadContract } from "wagmi";
import { curveLaunchpadAbi, curveFeeEscrowAbi, curveBuybackTreasuryAbi } from "../sdk/contracts";
import { launchpadAddress } from "./web3";
import type { CurveTapeDisplay } from "../components/MarketTape";
import { formatCompactUsd, useEthUsdRate } from "../components/UsdAmount";
import { activeChainId } from "./web3";
import { fetchMarketTapeStats, type MarketTapeStats } from "../markets/api";
import { socialApiBaseUrl } from "../social/api";

function formatTokenAmount(wei: string) {
  const amount = Number(formatEther(BigInt(wei)));
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1_000 ? 1 : 2,
  }).format(amount);
}

function displayStats(
  stats: MarketTapeStats,
  usdPerEth: number | null,
): CurveTapeDisplay {
  return {
    volume24h:
      usdPerEth === null
        ? "—"
        : formatCompactUsd(
            Number(formatEther(BigInt(stats.volume24hWei))) * usdPerEth,
          ),
    bought24h: formatTokenAmount(stats.bought24hWei),
    burnedTotal: formatTokenAmount(stats.burnedTotalWei),
  };
}

export function useCurveTapeStats() {
  const usdPerEth = useEthUsdRate();
  const { data: escrow } = useReadContract({
    address: launchpadAddress ?? undefined, abi: curveLaunchpadAbi, functionName: "escrow",
    chainId: activeChainId, query: { enabled: Boolean(launchpadAddress) },
  });
  const { data: treasury } = useReadContract({
    address: escrow, abi: curveFeeEscrowAbi, functionName: "buybackTreasury",
    chainId: activeChainId, query: { enabled: Boolean(escrow) },
  });
  const { data: token } = useReadContract({
    address: treasury, abi: curveBuybackTreasuryAbi, functionName: "curveToken",
    chainId: activeChainId, query: { enabled: Boolean(treasury) },
  });
  const query = useQuery({
    queryKey: ["market-tape", activeChainId, token],
    queryFn: ({ signal }) => fetchMarketTapeStats(token!, signal),
    enabled: Boolean(token && token !== zeroAddress && socialApiBaseUrl),
    staleTime: 5 * 60_000,
    refetchInterval: false,
    retry: 1,
  });
  return query.data ? displayStats(query.data, usdPerEth) : undefined;
}

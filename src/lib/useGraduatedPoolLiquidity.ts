import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { curveLaunchpadAbi, icarusPoolAbi } from "../sdk/contracts";
import type { Token } from "../types";
import { activeChainId, launchpadAddress } from "./web3";
import { poolLiquidityWeth } from "./poolLiquidity";

/** Live WETH-equivalent liquidity for graduated markets visible on the page. */
export function useGraduatedPoolLiquidity(tokens: Token[]) {
  const pools = useMemo(
    () => tokens.filter((token): token is Token & { pool: Address } =>
      token.graduated && Boolean(token.pool)),
    [tokens],
  );
  const { data: quoteToken } = useReadContract({
    address: launchpadAddress ?? undefined,
    abi: curveLaunchpadAbi,
    functionName: "quoteToken",
    chainId: activeChainId,
    query: { enabled: Boolean(launchpadAddress && pools.length) },
  });
  const contracts = useMemo(
    () => pools.flatMap((token) => [
      { address: token.pool, abi: icarusPoolAbi, functionName: "token0" as const, chainId: activeChainId },
      { address: token.pool, abi: icarusPoolAbi, functionName: "token1" as const, chainId: activeChainId },
      { address: token.pool, abi: icarusPoolAbi, functionName: "getReserves" as const, chainId: activeChainId },
    ]),
    [pools],
  );
  const { data } = useReadContracts({
    contracts,
    allowFailure: true,
    query: {
      enabled: contracts.length > 0,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });
  return useMemo(() => {
    const liquidity: Record<string, number> = {};
    pools.forEach((token, index) => {
      const token0Read = data?.[index * 3];
      const token1Read = data?.[index * 3 + 1];
      const reservesRead = data?.[index * 3 + 2];
      if (token0Read?.status !== "success" || token1Read?.status !== "success" || reservesRead?.status !== "success") return;
      const value = poolLiquidityWeth(
        token.address,
        quoteToken,
        token0Read.result as Address,
        token1Read.result as Address,
        reservesRead.result as readonly [bigint, bigint, bigint],
      );
      if (value !== null) liquidity[token.address.toLowerCase()] = value;
    });
    return liquidity;
  }, [pools, data, quoteToken]);
}

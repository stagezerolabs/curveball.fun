import { useReadContract } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "./contracts";

export function useTokenBalance(token?: Address, owner?: Address) {
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    query: {
      enabled: Boolean(token && owner),
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { useStore } from "../app/useStore";
import type { CreatorTokenClient } from "../creatorTokens";
import { loadMarketTradeSamples, type MarketPreviewStatsClient } from "../lib/marketPreviewStats";
import { activeChainId, activeDeploymentBlock } from "../lib/web3";
import type { Token } from "../types";
import { socialApi, socialApiConfigured } from "./api";
import { buildFollowingBuys } from "./followingBuys";
import type { FollowingBuy } from "./types";

export type FollowingBuyItem = { buy: FollowingBuy; token: Token | null };

type LoadMarkets = (client?: CreatorTokenClient) => Promise<Token[]>;

/** Markets followed wallets bought: from /v1/following/buys when configured, else every wallet's on-chain buys. */
export function useFollowingBuys(enabled = true) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const loadMarkets = useStore((state: { loadMarkets: LoadMarkets }) => state.loadMarkets);

  return useQuery({
    queryKey: ["social", "following-buys", socialApiConfigured ? "backend" : "rpc"],
    queryFn: async (): Promise<FollowingBuyItem[]> => {
      const client = publicClient as unknown as CreatorTokenClient | undefined;
      if (socialApiConfigured) {
        const [result, tokens] = await Promise.all([
          socialApi.followingBuys(),
          loadMarkets(client).catch((): Token[] => []),
        ]);
        return join(result.items, tokens);
      }
      const tokens = await loadMarkets(client);
      const samples = await loadMarketTradeSamples(publicClient as unknown as MarketPreviewStatsClient, tokens, activeDeploymentBlock);
      return join(buildFollowingBuys(samples, tokens), tokens);
    },
    enabled: enabled && (socialApiConfigured || Boolean(publicClient)),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

function join(buys: FollowingBuy[], tokens: readonly Token[]): FollowingBuyItem[] {
  const byAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  return buys.map((buy) => ({ buy, token: byAddress.get(buy.tokenAddress.toLowerCase()) ?? null }));
}

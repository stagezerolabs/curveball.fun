import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useStore } from "../app/useStore";
import type { CreatorTokenClient } from "../creatorTokens";
import type { Token } from "../types";
import { socialApi, socialApiConfigured } from "./api";
import type { FollowingBuy, PulsePeriod } from "./types";

export type FollowingBuyItem = { buy: FollowingBuy; token: Token | null };

type LoadMarkets = (client?: CreatorTokenClient) => Promise<Token[]>;

/** Markets bought by the linked wallet's followed traders. */
export function useFollowingBuys(period: PulsePeriod, enabled = true) {
  const { address } = useAccount();
  const loadMarkets = useStore((state: { loadMarkets: LoadMarkets }) => state.loadMarkets);

  return useQuery({
    queryKey: ["social", "following-buys", address?.toLowerCase(), period],
    queryFn: async (): Promise<FollowingBuyItem[]> => {
      const [result, tokens] = await Promise.all([
        socialApi.followingBuys(period),
        loadMarkets().catch((): Token[] => []),
      ]);
      return join(result.items, tokens);
    },
    enabled: enabled && socialApiConfigured && Boolean(address),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

function join(buys: FollowingBuy[], tokens: readonly Token[]): FollowingBuyItem[] {
  const byAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  return buys.map((buy) => ({ buy, token: byAddress.get(buy.tokenAddress.toLowerCase()) ?? null }));
}

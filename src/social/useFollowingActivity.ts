import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { usePublicClient } from "wagmi";
import { useStore } from "../app/useStore";
import type { CreatorTokenClient } from "../creatorTokens";
import {
  loadMarketTradeSamples,
  type MarketPreviewStatsClient,
} from "../lib/marketPreviewStats";
import { activeChainId, activeDeploymentBlock } from "../lib/web3";
import type { Token } from "../types";
import { socialApi, socialApiConfigured } from "./api";
import { buildFollowingActivity } from "./followingActivity";
import type { FollowingActivity } from "./types";

export type FollowingActivityItem = {
  activity: FollowingActivity;
  token: Token | null;
};

/** "following" is the viewer's own graph; "unlinked" is the no-backend fallback that lists every wallet. */
export type FollowingActivityFeed = {
  scope: "following" | "unlinked";
  followedCount: number;
  items: FollowingActivityItem[];
};

type LoadMarkets = (client?: CreatorTokenClient) => Promise<Token[]>;

/** Markets followed wallets created, bought or sold. Requires a signed-in viewer with follows. */
export function useFollowingActivity(enabled = true) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const { address } = useAccount();
  const loadMarkets = useStore(
    (state: { loadMarkets: LoadMarkets }) => state.loadMarkets,
  );

  return useQuery({
    queryKey: [
      "social",
      "following-activity",
      address?.toLowerCase(),
      socialApiConfigured ? "backend" : "rpc",
    ],
    queryFn: async (): Promise<FollowingActivityFeed> => {
      const client = publicClient as unknown as CreatorTokenClient | undefined;
      if (socialApiConfigured) {
        const [result, tokens] = await Promise.all([
          socialApi.followingActivity(),
          loadMarkets(client).catch((): Token[] => []),
        ]);
        return {
          scope: result.scope,
          followedCount: result.followedCount,
          items: join(result.items, tokens),
        };
      }
      const tokens = await loadMarkets(client);
      const samples = await loadMarketTradeSamples(
        publicClient as unknown as MarketPreviewStatsClient,
        tokens,
        activeDeploymentBlock,
      );
      const items = join(buildFollowingActivity(samples, tokens), tokens);
      return { scope: "unlinked", followedCount: 0, items };
    },
    enabled:
      enabled &&
      (socialApiConfigured ? Boolean(address) : Boolean(publicClient)),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

function join(
  items: FollowingActivity[],
  tokens: readonly Token[],
): FollowingActivityItem[] {
  const byAddress = new Map(
    tokens.map((token) => [token.address.toLowerCase(), token]),
  );
  return items.map((activity) => ({
    activity,
    token: byAddress.get(activity.tokenAddress.toLowerCase()) ?? null,
  }));
}

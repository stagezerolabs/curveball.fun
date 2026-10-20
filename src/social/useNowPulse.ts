import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { useStore } from "../app/useStore";
import type { CreatorTokenClient } from "../creatorTokens";
import { loadMarketTradeSamples, type MarketPreviewStatsClient } from "../lib/marketPreviewStats";
import { activeChainId, activeDeploymentBlock } from "../lib/web3";
import type { Token } from "../types";
import { socialApi, socialApiConfigured } from "./api";
import { buildNowMoments } from "./nowPulse";
import type { PulseMoment, PulsePeriod } from "./types";

export type NowPulseItem = { moment: PulseMoment; token: Token | null };

type LoadMarkets = (client?: CreatorTokenClient) => Promise<Token[]>;

/** Markets being bought into over the window: from /v1/pulse when configured, else from on-chain trades. */
export function useNowPulse(period: PulsePeriod, enabled = true) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const loadMarkets = useStore((state: { loadMarkets: LoadMarkets }) => state.loadMarkets);
  const source = socialApiConfigured ? "backend" : "rpc";

  return useQuery({
    queryKey: ["pulse", "now", period, source],
    queryFn: async (): Promise<NowPulseItem[]> => {
      const client = publicClient as unknown as CreatorTokenClient | undefined;
      if (socialApiConfigured) {
        const [pulse, tokens] = await Promise.all([
          socialApi.pulse("now", period),
          loadMarkets(client).catch((): Token[] => []),
        ]);
        return join(pulse.items.filter((moment) => BigInt(moment.netQuoteWei) > 0n), tokens);
      }
      const tokens = await loadMarkets(client);
      const samples = await loadMarketTradeSamples(publicClient as unknown as MarketPreviewStatsClient, tokens, activeDeploymentBlock);
      return join(buildNowMoments(samples, tokens, period), tokens);
    },
    enabled: enabled && (socialApiConfigured || Boolean(publicClient)),
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

function join(moments: PulseMoment[], tokens: readonly Token[]): NowPulseItem[] {
  const byAddress = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  return moments.map((moment) => ({ moment, token: byAddress.get(moment.tokenAddress.toLowerCase()) ?? null }));
}

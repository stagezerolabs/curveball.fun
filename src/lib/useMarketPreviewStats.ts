import { useEffect, useMemo, useState } from "react";
import type { Token } from "../types";
import {
  loadMarketPreviewStats,
  type MarketPreviewStatsByToken,
  type MarketPreviewStatsClient,
} from "./marketPreviewStats";
import { activeDeploymentBlock } from "./web3";

export function useMarketPreviewStats(
  client: MarketPreviewStatsClient | undefined,
  tokens: readonly Token[],
  refreshKey: number,
) {
  const [stats, setStats] = useState<MarketPreviewStatsByToken>({});
  const tokenSignature = useMemo(
    () => tokens.map((token) => `${token.address}:${token.factory ?? ""}:${token.createdBlock ?? ""}:${token.price ?? ""}`).join("|"),
    [tokens],
  );

  useEffect(() => {
    let cancelled = false;
    if (!client || !tokens.length) {
      setStats({});
      return undefined;
    }
    void loadMarketPreviewStats(client, tokens, activeDeploymentBlock)
      .then((nextStats) => {
        if (!cancelled) setStats(nextStats);
      })
      .catch(() => {
        // Keep the market cards usable when an RPC rejects the supplementary log query.
      });
    return () => { cancelled = true; };
  }, [client, refreshKey, tokenSignature]);

  return stats;
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Token } from "../types";
import { fetchMarketPreviewStats } from "../markets/api";
import { socialApiBaseUrl } from "../social/api";
import {
  loadMarketPreviewStats,
  type MarketPreviewStatsClient,
} from "./marketPreviewStats";
import { activeDeploymentBlock } from "./web3";

// refreshKey is accepted for call-site compatibility but deliberately not part
// of the query key: markets ticking should never invalidate cached stats.
export function useMarketPreviewStats(
  client: MarketPreviewStatsClient | undefined,
  tokens: readonly Token[],
  _refreshKey: number,
) {
  // Key on the token set only, never on prices or the markets fetchedAt tick:
  // including those changed the query key on every market refresh, dropping the
  // cached stats to undefined and flickering every card on the list. A slow
  // background interval keeps stats fresh without that churn.
  const tokenSignature = useMemo(
    () =>
      tokens
        .map((token) => `${token.address}:${token.factory ?? ""}`)
        .join("|"),
    [tokens],
  );

  const backendEnabled = Boolean(socialApiBaseUrl);
  const query = useQuery({
    queryKey: [
      "markets",
      "preview-stats",
      tokenSignature,
      backendEnabled ? "backend" : "rpc",
    ],
    queryFn: ({ signal }) =>
      backendEnabled
        ? fetchMarketPreviewStats(tokens, signal)
        : loadMarketPreviewStats(client!, tokens, activeDeploymentBlock),
    enabled: tokens.length > 0 && (backendEnabled || Boolean(client)),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    placeholderData: (previous) => previous,
  });
  return query.data ?? {};
}

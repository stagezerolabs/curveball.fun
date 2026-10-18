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

export function useMarketPreviewStats(
  client: MarketPreviewStatsClient | undefined,
  tokens: readonly Token[],
  refreshKey: number,
) {
  const tokenSignature = useMemo(
    () => tokens.map((token) => `${token.address}:${token.curve ?? ""}:${token.createdBlock ?? ""}:${token.price ?? ""}`).join("|"),
    [tokens],
  );

  const backendEnabled = Boolean(socialApiBaseUrl);
  const query = useQuery({
    queryKey: ["markets", "preview-stats", tokenSignature, refreshKey, backendEnabled ? "backend" : "rpc"],
    queryFn: ({ signal }) => backendEnabled
      ? fetchMarketPreviewStats(tokens, signal)
      : loadMarketPreviewStats(client!, tokens, activeDeploymentBlock),
    enabled: tokens.length > 0 && (backendEnabled || Boolean(client)),
    staleTime: 15_000,
    retry: 1,
  });
  return query.data ?? {};
}

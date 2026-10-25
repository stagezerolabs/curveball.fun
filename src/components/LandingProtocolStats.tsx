import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import type { CreatorTokenClient } from "../creatorTokens";
import { useStore } from "../app/useStore.js";
import { UsdAmount } from "./UsdAmount";
import {
  readCachedLaunches,
  readCachedPayout,
  writeCachedLaunches,
  writeCachedPayout,
} from "../lib/landingStatsCache";
import { getCreatorEarnings } from "../lib/protocolStats";
import {
  activeChainId,
  activeDeploymentBlock,
  launchpadAddress,
} from "../lib/web3";
import type { Token } from "../types";

export function useProtocolStats() {
  const client = usePublicClient({ chainId: activeChainId });
  const loadMarkets = useStore((state) => state.loadMarkets) as (
    client?: CreatorTokenClient,
  ) => Promise<Token[]>;
  const factoryKey = launchpadAddress
    ? `${launchpadAddress.toLowerCase()}:${activeDeploymentBlock}`
    : "";
  const cacheKey = `curveball:landing-stats:current:${activeChainId}:${factoryKey}`;
  const [cachedLaunches] = useState(() => readCachedLaunches(cacheKey));
  const [cachedPayout] = useState(() => readCachedPayout(cacheKey));
  const statsEnabled = Boolean(client && launchpadAddress);
  const {
    data,
    isPending,
    isFetching,
    isError,
    dataUpdatedAt,
    refetch: refetchLaunches,
  } = useQuery({
    queryKey: ["landing-launch-stats", activeChainId, factoryKey],
    enabled: statsEnabled,
    initialData: cachedLaunches?.value,
    initialDataUpdatedAt: cachedLaunches?.updatedAt,
    staleTime: 300_000,
    retry: 1,
    queryFn: async () => {
      const tokens = await loadMarkets(client as unknown as CreatorTokenClient);
      const launches = tokens.map(
        ({
          address,
          factory,
          creator,
          graduated,
          createdBlock,
          name,
          symbol,
          createdAt,
        }) => ({
          address,
          factory,
          creator,
          graduated,
          createdBlock,
          name,
          symbol,
          createdAt,
        }),
      );
      writeCachedLaunches(cacheKey, launches);
      return launches;
    },
  });
  const payoutEnabled = Boolean(client && launchpadAddress && data);
  const {
    data: payout,
    isPending: payoutPending,
    isFetching: payoutFetching,
    isError: payoutError,
    refetch: refetchPayout,
  } = useQuery({
    queryKey: ["landing-creator-earnings", activeChainId, factoryKey],
    enabled: payoutEnabled,
    initialData: cachedPayout?.value,
    initialDataUpdatedAt: cachedPayout?.updatedAt,
    staleTime: 300_000,
    retry: 1,
    queryFn: async () => {
      const result = await getCreatorEarnings(
        client as unknown as Parameters<typeof getCreatorEarnings>[0],
        launchpadAddress!,
        data!,
        activeDeploymentBlock,
      );
      writeCachedPayout(cacheKey, result);
      return result;
    },
  });
  return {
    data,
    payout,
    isPending,
    isFetching,
    isError,
    payoutPending,
    payoutFetching,
    payoutError,
    statsEnabled,
    payoutEnabled,
    dataUpdatedAt,
    refetchLaunches,
    refetchPayout,
  };
}

export function LandingProtocolStats() {
  const {
    data,
    payout,
    isPending,
    payoutPending,
    statsEnabled,
    payoutEnabled,
  } = useProtocolStats();
  const loading = (
    <>
      <span className="landing-stat-placeholder" aria-hidden="true" />
      <span className="visually-hidden">Loading</span>
    </>
  );
  const fallback = statsEnabled && isPending ? loading : "Unavailable";
  const paid = payout
    ? Number(formatUnits(payout.amount, payout.decimals))
    : null;

  return (
    <section
      className="landing-proof"
      aria-label="Protocol stats from the active factory"
    >
      <div className="landing-proof-inner wrap">
        <dl
          className="landing-proof-stats"
          aria-busy={
            (statsEnabled && isPending) || (payoutEnabled && payoutPending)
          }
        >
          <div>
            <dt>Tokens created</dt>
            <dd
              className={
                !data && !(statsEnabled && isPending)
                  ? "landing-stat-unavailable"
                  : undefined
              }
            >
              {data ? new Intl.NumberFormat().format(data.length) : fallback}
            </dd>
          </div>
          <div>
            <dt>Markets graduated</dt>
            <dd
              className={
                !data && !(statsEnabled && isPending)
                  ? "landing-stat-unavailable"
                  : undefined
              }
            >
              {data
                ? new Intl.NumberFormat().format(
                    data.filter((token) => token.graduated).length,
                  )
                : fallback}
            </dd>
          </div>
          <div>
            <dt>Fees earned by creators</dt>
            <dd
              className={
                paid === null && !(payoutEnabled && payoutPending)
                  ? "landing-stat-unavailable"
                  : undefined
              }
            >
              {paid === null ? (
                payoutEnabled && payoutPending ? (
                  loading
                ) : (
                  "Unavailable"
                )
              ) : (
                <UsdAmount weth={paid} compact />
              )}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

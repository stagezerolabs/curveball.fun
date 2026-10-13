import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import type { CreatorTokenClient } from "../creatorTokens";
import { useStore } from "../app/useStore.js";
import { UsdAmount } from "./UsdAmount";
import { readCachedLaunches, readCachedPayout, writeCachedLaunches, writeCachedPayout } from "../lib/landingStatsCache";
import { getCreatorPayouts } from "../lib/protocolStats";
import { activeChainId, activeContractVersion, launchpadAddress } from "../lib/web3";
import { marketFactories } from "../lib/marketFactories";
import type { Token } from "../types";

export function LandingProtocolStats() {
  const client = usePublicClient({ chainId: activeChainId });
  const loadMarkets = useStore((state) => state.loadMarkets) as (client?: CreatorTokenClient) => Promise<Token[]>;
  const factoryKey = marketFactories().map(({ address, fromBlock }) => `${address.toLowerCase()}:${fromBlock}`).join(":");
  const cacheKey = `curveball:landing-stats:v3:${activeContractVersion}:${activeChainId}:${factoryKey}`;
  const [cachedLaunches] = useState(() => readCachedLaunches(cacheKey));
  const [cachedPayout] = useState(() => readCachedPayout(cacheKey));
  const statsEnabled = Boolean(client && launchpadAddress);
  const { data, isPending } = useQuery({
    queryKey: ["landing-launch-stats", activeChainId, factoryKey],
    enabled: statsEnabled,
    initialData: cachedLaunches?.value,
    initialDataUpdatedAt: cachedLaunches?.updatedAt,
    staleTime: 300_000,
    retry: 1,
    queryFn: async () => {
      const tokens = await loadMarkets(client as unknown as CreatorTokenClient);
      const launches = tokens.map(({ address, factory, creator, graduated, createdBlock }) => ({ address, factory, creator, graduated, createdBlock }));
      writeCachedLaunches(cacheKey, launches);
      return launches;
    },
  });
  const payoutEnabled = activeContractVersion === "v2" && Boolean(client && launchpadAddress && data);
  const { data: payout, isPending: payoutPending } = useQuery({
    queryKey: ["landing-creator-payouts", activeChainId, factoryKey],
    enabled: payoutEnabled,
    initialData: cachedPayout?.value,
    initialDataUpdatedAt: cachedPayout?.updatedAt,
    staleTime: 300_000,
    retry: 1,
    queryFn: async () => {
      const results = await Promise.all(marketFactories().map(async ({ address, fromBlock }) => {
        const owned = data!.filter((token) => token.factory?.toLowerCase() === address.toLowerCase());
        return getCreatorPayouts(client as unknown as Parameters<typeof getCreatorPayouts>[0], address, owned, fromBlock);
      }));
      const result = { amount: results.reduce((sum, entry) => sum + entry.amount, 0n), decimals: results[0]?.decimals ?? 18 };
      writeCachedPayout(cacheKey, result);
      return result;
    },
  });
  const loading = <><span className="landing-stat-placeholder" aria-hidden="true" /><span className="visually-hidden">Loading</span></>;
  const fallback = statsEnabled && isPending ? loading : "Unavailable";
  const paid = payout ? Number(formatUnits(payout.amount, payout.decimals)) : null;

  return (
    <section className="landing-proof" aria-label="Protocol stats on RISE Testnet">
      <div className="landing-proof-inner wrap">
        <dl className="landing-proof-stats" aria-busy={(statsEnabled && isPending) || (payoutEnabled && payoutPending)}>
          <div><dt>Tokens created</dt><dd className={!data && !(statsEnabled && isPending) ? "landing-stat-unavailable" : undefined}>{data ? new Intl.NumberFormat().format(data.length) : fallback}</dd></div>
          <div><dt>Markets graduated</dt><dd className={!data && !(statsEnabled && isPending) ? "landing-stat-unavailable" : undefined}>{data ? new Intl.NumberFormat().format(data.filter((token) => token.graduated).length) : fallback}</dd></div>
          {activeContractVersion === "v2" && <div><dt>Claimed by creators</dt><dd className={paid === null && !(payoutEnabled && payoutPending) ? "landing-stat-unavailable" : undefined}>{paid === null ? (payoutEnabled && payoutPending ? loading : "Unavailable") : <UsdAmount weth={paid} compact />}</dd></div>}
        </dl>
      </div>
    </section>
  );
}

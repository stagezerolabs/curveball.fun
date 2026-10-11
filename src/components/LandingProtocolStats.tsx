import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import type { CreatorTokenClient } from "../creatorTokens";
import { useStore } from "../app/useStore.js";
import { readCachedLaunches, readCachedPayout, writeCachedLaunches, writeCachedPayout } from "../lib/landingStatsCache";
import { getCreatorPayouts } from "../lib/protocolStats";
import { activeChainId, activeContractVersion, activeDeploymentBlock, launchpadAddress, marketFactories } from "../lib/web3";
import type { Token } from "../types";

export function LandingProtocolStats() {
  const client = usePublicClient({ chainId: activeChainId });
  const loadMarkets = useStore((state) => state.loadMarkets) as (client?: CreatorTokenClient) => Promise<Token[]>;
  const cacheKey = `curveball:landing-stats:v3:${activeContractVersion}:${activeChainId}:${launchpadAddress?.toLowerCase() ?? "none"}:${activeDeploymentBlock}`;
  const [cachedLaunches] = useState(() => readCachedLaunches(cacheKey));
  const [cachedPayout] = useState(() => readCachedPayout(cacheKey));
  const statsEnabled = Boolean(client && launchpadAddress);
  const { data, isPending } = useQuery({
    queryKey: ["landing-launch-stats", activeChainId, launchpadAddress, activeDeploymentBlock.toString()],
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
    queryKey: ["landing-creator-payouts", activeChainId, launchpadAddress, activeDeploymentBlock.toString()],
    enabled: payoutEnabled,
    initialData: cachedPayout?.value,
    initialDataUpdatedAt: cachedPayout?.updatedAt,
    staleTime: 300_000,
    retry: 1,
    queryFn: async () => {
      const payouts = await Promise.all(marketFactories.map(async ({ address, fromBlock }) => {
        const tokens = data!.filter((token) => token.factory?.toLowerCase() === address.toLowerCase());
        return tokens.length ? getCreatorPayouts(client as unknown as Parameters<typeof getCreatorPayouts>[0], address, tokens, fromBlock) : null;
      }));
      const recorded = payouts.filter((item): item is NonNullable<typeof item> => item !== null);
      if (recorded.some((item) => item.decimals !== recorded[0].decimals)) throw new Error("Market quote decimals differ across factories.");
      const result = { amount: recorded.reduce((sum, item) => sum + item.amount, 0n), decimals: recorded[0]?.decimals ?? 18 };
      writeCachedPayout(cacheKey, result);
      return result;
    },
  });
  const loading = <><span className="landing-stat-placeholder" aria-hidden="true" /><span className="visually-hidden">Loading</span></>;
  const fallback = statsEnabled && isPending ? loading : "Unavailable";
  const paid = payout ? Number(formatUnits(payout.amount, payout.decimals)) : null;
  const paidLabel = paid === null ? (payoutEnabled && payoutPending ? loading : "Unavailable") : paid > 0 && paid < 0.001 ? "<0.001" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(paid);

  return (
    <section className="landing-proof" aria-label="Protocol stats on RISE Testnet">
      <div className="landing-proof-inner wrap">
        <dl className="landing-proof-stats" aria-busy={(statsEnabled && isPending) || (payoutEnabled && payoutPending)}>
          <div><dt>Tokens created</dt><dd className={!data && !(statsEnabled && isPending) ? "landing-stat-unavailable" : undefined}>{data ? new Intl.NumberFormat().format(data.length) : fallback}</dd></div>
          <div><dt>Markets graduated</dt><dd className={!data && !(statsEnabled && isPending) ? "landing-stat-unavailable" : undefined}>{data ? new Intl.NumberFormat().format(data.filter((token) => token.graduated).length) : fallback}</dd></div>
          {activeContractVersion === "v2" && <div><dt>Claimed by creators</dt><dd className={paid === null && !(payoutEnabled && payoutPending) ? "landing-stat-unavailable" : undefined}>{paidLabel}{paid !== null && <small> WETH</small>}</dd></div>}
        </dl>
      </div>
    </section>
  );
}

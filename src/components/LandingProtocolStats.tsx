import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { discoverAllTokens, type CreatorTokenClient } from "../creatorTokens";
import { readCachedLaunches, readCachedPayout, writeCachedLaunches, writeCachedPayout } from "../lib/landingStatsCache";
import { getCreatorPayouts } from "../lib/protocolStats";
import { activeChainId, activeContractVersion, activeDeploymentBlock, launchpadAddress } from "../lib/web3";

export function LandingProtocolStats() {
  const client = usePublicClient({ chainId: activeChainId });
  const cacheKey = `curveball:landing-stats:v1:${activeContractVersion}:${activeChainId}:${launchpadAddress?.toLowerCase() ?? "none"}:${activeDeploymentBlock}`;
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
      const tokens = await discoverAllTokens(client as unknown as CreatorTokenClient);
      const launches = tokens.map(({ address, creator, graduated }) => ({ address, creator, graduated }));
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
      const result = await getCreatorPayouts(client as unknown as Parameters<typeof getCreatorPayouts>[0], launchpadAddress!, data!, activeDeploymentBlock);
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

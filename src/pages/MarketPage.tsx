import { lazy, Suspense, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { getAddress, isAddress, type Address } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { MarketHeader } from "../components/MarketHeader";
import { MilestonePanel } from "../components/MilestonePanel";
import { TradePanel } from "../components/TradePanel";
import type { CreatorTokenClient } from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import type { MarketPriceChange } from "../lib/marketChart";
import { v2CurveAbi } from "../sdk/v2Contracts";
import type { Navigate, Token } from "../types";

const MarketChart = lazy(() =>
  import("../components/MarketChart").then((module) => ({
    default: module.MarketChart,
  })),
);

function MarketPageSkeleton() {
  return (
    <main className="market-page market-page-skeleton wrap" aria-busy="true" aria-label="Loading market">
      <div className="market-header-skeleton">
        <span className="skeleton skeleton-circle" />
        <span className="skeleton skeleton-line skeleton-title" />
        <span className="skeleton skeleton-line skeleton-cap" />
      </div>
      <div className="skeleton market-panel-skeleton" />
      <div className="skeleton market-panel-skeleton" />
    </main>
  );
}

export function MarketPage({
  tokenAddress,
  navigate,
}: {
  tokenAddress: string;
  navigate: Navigate;
}) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const validAddress = isAddress(tokenAddress);
  const address = validAddress ? getAddress(tokenAddress) : undefined;
  const key = tokenAddress.toLowerCase();
  const { tokenCache, tokenFetchedAt, tokenErrors, actionError, loadToken } = useStore() as {
    tokenCache: Record<string, Token | null>;
    tokenFetchedAt: Record<string, number>;
    tokenErrors: Record<string, string>;
    actionError: string;
    loadToken: (client: CreatorTokenClient | undefined, address: Address, options?: { force?: boolean }) => Promise<Token | null>;
  };
  const { address: walletAddress } = useAccount();
  const hasCachedResult = Object.prototype.hasOwnProperty.call(tokenCache, key);
  const resolvedToken = tokenCache[key];
  const fetchedAt = tokenFetchedAt[key];
  const discoveryError = tokenErrors[key];
  const error = actionError || discoveryError;
  const [marketCapChange, setMarketCapChange] = useState<MarketPriceChange | null>(null);

  useEffect(() => setMarketCapChange(null), [key]);

  useEffect(() => {
    if (!address) return;
    void loadToken(
      publicClient as unknown as CreatorTokenClient | undefined,
      address,
    ).catch(() => undefined);
  }, [address, fetchedAt, loadToken, publicClient]);

  useEffect(() => {
    if (!address || !resolvedToken?.curve || resolvedToken.graduated || !publicClient) return;
    const curve = resolvedToken.curve;
    const shownSoldOut = Boolean(resolvedToken.pending || (resolvedToken.progress ?? 0) >= 100);
    let checking = false;
    let active = true;
    const refreshStatus = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const [sold, curveSupply, graduated] = await Promise.all([
          publicClient.readContract({ address: curve, abi: v2CurveAbi, functionName: "sold" }),
          publicClient.readContract({ address: curve, abi: v2CurveAbi, functionName: "curveSupply" }),
          publicClient.readContract({ address: curve, abi: v2CurveAbi, functionName: "graduated" }),
        ]);
        if (active && (graduated || (sold === curveSupply) !== shownSoldOut)) {
          await loadToken(publicClient as unknown as CreatorTokenClient, address, { force: true });
        }
      } catch { /* The next poll will retry a temporary RPC failure. */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => { void refreshStatus(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [address, resolvedToken?.curve, resolvedToken?.graduated, resolvedToken?.pending, resolvedToken?.progress, publicClient, loadToken]);

  if (validAddress && !hasCachedResult && !discoveryError) {
    return <MarketPageSkeleton />;
  }
  if (!resolvedToken) {
    return (
      <main className="page-status wrap">
        <span className="empty-orbit" />
        <h1>Market not found</h1>
        <p>{error || "This curve does not exist on the configured network."}</p>
        <AppLink className="primary-button" route="markets" navigate={navigate}>
          Back to markets
        </AppLink>
      </main>
    );
  }

  return (
    <main className="market-page wrap">
      <MarketHeader token={resolvedToken} marketCapChange={marketCapChange} />

      <div className="market-workspace">
        <Suspense
          fallback={
            <div
              className="market-chart-panel market-chart-lazy skeleton"
              aria-label="Loading chart"
            />
          }
        >
          <MarketChart token={resolvedToken} refreshKey={fetchedAt} onMarketCapChange={setMarketCapChange} />
        </Suspense>
        <aside className="market-sidebar" aria-label="Market actions">
          <TradePanel
            token={resolvedToken}
            address={walletAddress}
          />
          <MilestonePanel
            token={resolvedToken}
            address={walletAddress}
          />
        </aside>
      </div>

      {error && (
        <div className="notice notice-dismissible floating-notice" role="alert">
          <span>{error}</span>
          {actionError && (
            <button type="button" onClick={() => useStore.getState().setActionError("")} aria-label="Dismiss error">×</button>
          )}
        </div>
      )}
    </main>
  );
}

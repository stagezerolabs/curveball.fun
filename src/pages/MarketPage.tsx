import { lazy, Suspense, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { getAddress, isAddress, type Address } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { MarketHeader } from "../components/MarketHeader";
import { MarketTabs } from "../components/MarketTabs";
import { MilestonePanel } from "../components/MilestonePanel";
import { TradePanel } from "../components/TradePanel";
import type { CreatorTokenClient } from "../creatorTokens";
import { activeChainId } from "../lib/web3";
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
        <span className="skeleton skeleton-line skeleton-price" />
      </div>
      <div className="skeleton market-panel-skeleton" />
      <div className="skeleton market-panel-skeleton" />
      <div className="skeleton market-tabs-skeleton" />
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
    loadToken: (client: CreatorTokenClient | undefined, address: Address) => Promise<Token | null>;
  };
  const { address: walletAddress } = useAccount();
  const hasCachedResult = Object.prototype.hasOwnProperty.call(tokenCache, key);
  const resolvedToken = tokenCache[key];
  const fetchedAt = tokenFetchedAt[key];
  const discoveryError = tokenErrors[key];
  const error = actionError || discoveryError;

  useEffect(() => {
    if (!address) return;
    void loadToken(
      publicClient as unknown as CreatorTokenClient | undefined,
      address,
    ).catch(() => undefined);
  }, [address, fetchedAt, loadToken, publicClient]);

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
      <MarketHeader token={resolvedToken} />

      <div className="market-workspace">
        <Suspense
          fallback={
            <div
              className="market-chart-panel market-chart-lazy skeleton"
              aria-label="Loading chart"
            />
          }
        >
          <MarketChart token={resolvedToken} refreshKey={fetchedAt} />
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

      <MarketTabs token={resolvedToken} />

      <p className="disclaimer">
        Market state is read directly from the configured network. Nothing here is financial advice.
      </p>

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

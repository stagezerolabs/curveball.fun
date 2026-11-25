import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { getAddress, isAddress, type Address } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { MarketHeader } from "../components/MarketHeader";
import { MarketAbout } from "../components/MarketAbout";
import { MilestonePanel } from "../components/MilestonePanel";
import { TradePanel } from "../components/TradePanel";
import {
  marketFields,
  readMarket,
  type CreatorTokenClient,
} from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import { isHiddenMarketAddress } from "../lib/marketVisibility";
import type { MarketPriceChange } from "../lib/marketChart";
import { useMarketPreviewStats } from "../lib/useMarketPreviewStats";
import type { MarketPreviewStatsClient } from "../lib/marketPreviewStats";
import { socialApiBaseUrl } from "../social/api";
import { resolveMarketSlug } from "../markets/api";
import { routeHref } from "../app/routeTree";
import { tokenDetails } from "../lib/tokenMetadata";
import type { Navigate, Token } from "../types";

const MarketChart = lazy(() =>
  import("../components/MarketChart").then((module) => ({
    default: module.MarketChart,
  })),
);

function MarketPageSkeleton() {
  return (
    <main
      className="market-page market-page-skeleton wrap"
      aria-busy="true"
      aria-label="Loading market"
    >
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
  const backendEnabled = Boolean(socialApiBaseUrl);
  const directAddress = isAddress(tokenAddress);
  const slug = !directAddress && /^[a-z0-9-]{1,122}$/.test(tokenAddress)
    ? tokenAddress
    : null;
  const slugLookup = useQuery({
    queryKey: ["market-slug", slug],
    queryFn: () => resolveMarketSlug(slug ?? ""),
    enabled: Boolean(backendEnabled && slug),
    retry: false,
  });
  const address = directAddress ? getAddress(tokenAddress) : slugLookup.data;
  const hidden = isHiddenMarketAddress(address ?? tokenAddress);
  const key = (address ?? tokenAddress).toLowerCase();
  const { tokenCache, tokenFetchedAt, tokenErrors, actionError, loadToken } =
    useStore() as {
      tokenCache: Record<string, Token | null>;
      tokenFetchedAt: Record<string, number>;
      tokenErrors: Record<string, string>;
      actionError: string;
      loadToken: (
        client: CreatorTokenClient | undefined,
        address: Address,
        options?: { force?: boolean },
      ) => Promise<Token | null>;
    };
  const { address: walletAddress } = useAccount();
  const hasCachedResult =
    hidden || Object.prototype.hasOwnProperty.call(tokenCache, key);
  const resolvedToken = hidden ? null : tokenCache[key];
  const [metadataDetails, setMetadataDetails] = useState<Awaited<ReturnType<typeof tokenDetails>>>(null);
  useEffect(() => {
    let active = true;
    setMetadataDetails(null);
    if (resolvedToken?.metadataUri)
      void tokenDetails(resolvedToken.metadataUri).then((value) => {
        if (active) setMetadataDetails(value);
      });
    return () => { active = false; };
  }, [resolvedToken?.metadataUri]);
  const displayedToken = resolvedToken && metadataDetails
    ? {
        ...resolvedToken,
        bio: resolvedToken.bio || metadataDetails.bio,
        description: resolvedToken.description || metadataDetails.description,
        website: resolvedToken.website || metadataDetails.website,
        xUrl: resolvedToken.xUrl || metadataDetails.xUrl,
        telegramUrl: resolvedToken.telegramUrl || metadataDetails.telegramUrl,
        discordUrl: resolvedToken.discordUrl || metadataDetails.discordUrl,
      }
    : resolvedToken;
  const fetchedAt = tokenFetchedAt[key];
  const statsTokens = useMemo(
    () => (resolvedToken ? [resolvedToken] : []),
    [resolvedToken],
  );
  const activityStats = useMarketPreviewStats(
    publicClient as unknown as MarketPreviewStatsClient | undefined,
    statsTokens,
    fetchedAt ?? 0,
  );
  const discoveryError = tokenErrors[key];
  const error = hidden
    ? ""
    : actionError || discoveryError ||
      (slugLookup.error instanceof Error ? slugLookup.error.message : "");
  const [marketCapChange, setMarketCapChange] =
    useState<MarketPriceChange | null>(null);

  useEffect(() => setMarketCapChange(null), [key]);

  useEffect(() => {
    const canonical = resolvedToken?.slug;
    if (directAddress && canonical && !hidden)
      window.history.replaceState(
        window.history.state,
        "",
        routeHref("market", { address: canonical }),
      );
  }, [directAddress, hidden, resolvedToken?.slug]);

  useEffect(() => {
    if (!address) return;
    void loadToken(
      publicClient as unknown as CreatorTokenClient | undefined,
      address,
    ).catch(() => undefined);
  }, [address, loadToken, publicClient]);

  useEffect(() => {
    if (
      !address ||
      !resolvedToken?.factory ||
      !resolvedToken.supply ||
      !resolvedToken.curveSupply ||
      resolvedToken.graduated ||
      (!publicClient && !backendEnabled)
    )
      return;
    const launchpad = resolvedToken.factory;
    const tokenSupply = BigInt(resolvedToken.supply);
    const curveSupply = BigInt(resolvedToken.curveSupply);
    const shownLifecycle = resolvedToken.lifecycle;
    const shownSoldOut = Boolean(
      resolvedToken.pending || (resolvedToken.progress ?? 0) >= 100,
    );
    let checking = false;
    let active = true;
    const refreshStatus = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        if (backendEnabled) {
          await loadToken(
            publicClient as unknown as CreatorTokenClient | undefined,
            address,
            { force: true },
          );
          return;
        }
        if (!publicClient) return;
        const market = marketFields(
          await readMarket(
            publicClient as unknown as CreatorTokenClient,
            launchpad,
            address,
          ),
          tokenSupply,
          curveSupply,
        );
        if (
          active &&
          (market.lifecycle !== shownLifecycle ||
            market.progress >= 100 !== shownSoldOut)
        ) {
          await loadToken(
            publicClient as unknown as CreatorTokenClient,
            address,
            { force: true },
          );
        }
      } catch {
        /* The next poll will retry a temporary RPC failure. */
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    address,
    backendEnabled,
    resolvedToken?.factory,
    resolvedToken?.graduated,
    resolvedToken?.lifecycle,
    resolvedToken?.pending,
    resolvedToken?.progress,
    resolvedToken?.supply,
    resolvedToken?.curveSupply,
    publicClient,
    loadToken,
  ]);

  if (
    (!directAddress && slug && backendEnabled && slugLookup.isPending) ||
    (address && !hasCachedResult && !discoveryError && !hidden)
  ) {
    return <MarketPageSkeleton />;
  }
  if (!resolvedToken) {
    return (
      <main className="page-status wrap">
        <span className="empty-orbit" />
        <h1>Market not found</h1>
        <p>
          {error || "This market does not exist on the configured network."}
        </p>
        <AppLink className="primary-button" route="markets" navigate={navigate}>
          Back to markets
        </AppLink>
      </main>
    );
  }

  return (
    <main className="market-page wrap">
      <MarketHeader
        token={displayedToken ?? resolvedToken}
        marketCapChange={marketCapChange}
        activityStats={activityStats[key]}
      />

      <div className="market-workspace">
        <div className="market-workspace-main">
          <Suspense
            fallback={
              <div
                className="market-chart-panel market-chart-lazy skeleton"
                aria-label="Loading chart"
              />
            }
          >
            <MarketChart
              token={resolvedToken}
              navigate={navigate}
              refreshKey={fetchedAt}
              onMarketCapChange={setMarketCapChange}
            />
          </Suspense>
        </div>
        <aside className="market-sidebar" aria-label="Market actions">
          <TradePanel token={resolvedToken} address={walletAddress} />
          <MilestonePanel token={resolvedToken} address={walletAddress} />
        </aside>
      </div>

      <MarketAbout token={displayedToken ?? resolvedToken} navigate={navigate} />

      {error && (
        <div className="notice notice-dismissible floating-notice" role="alert">
          <span>{error}</span>
          {actionError && (
            <button
              type="button"
              onClick={() => useStore.getState().setActionError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          )}
        </div>
      )}
    </main>
  );
}

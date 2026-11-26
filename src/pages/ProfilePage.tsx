import { InlineArrow } from "../components/ArrowIcon";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { LaunchGallery, LaunchSummary } from "../components/LaunchGallery";
import { TraderProfileSkeleton } from "../components/TraderProfileSkeleton";
import type { CreatorTokenClient } from "../creatorTokens";
import { fetchCreatorMarkets } from "../markets/api";
import { socialApiConfigured } from "../social/api";
import { activeChainId } from "../lib/web3";
import type { Navigate, Token } from "../types";
import type { ProfileTab } from "./TraderProfilePage";
import { selectProfileAuthView } from "./profileAuthGate";

const TraderProfilePage = lazy(() =>
  import("./TraderProfilePage").then((module) => ({
    default: module.TraderProfilePage,
  })),
);

function CreatorLaunchDashboard({
  address,
  navigate,
}: {
  address: Address;
  navigate: Navigate;
}) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const key = address.toLowerCase();
  const { creatorTokens, creatorErrors, loadCreatorTokens } = useStore() as {
    creatorTokens: Record<string, Token[]>;
    creatorErrors: Record<string, string>;
    loadCreatorTokens: (
      client: CreatorTokenClient | undefined,
      creator: Address,
      options?: { force?: boolean },
    ) => Promise<Token[]>;
  };
  const hasCachedResult = Object.prototype.hasOwnProperty.call(
    creatorTokens,
    key,
  );
  const creatorMarkets = useQuery({
    queryKey: ["markets", "creator", key],
    queryFn: ({ signal }) => fetchCreatorMarkets(address, signal),
    enabled: socialApiConfigured,
    staleTime: 15_000,
  });
  const tokens = socialApiConfigured
    ? (creatorMarkets.data ?? [])
    : (creatorTokens[key] ?? []);
  const error = socialApiConfigured
    ? creatorMarkets.error instanceof Error
      ? creatorMarkets.error.message
      : null
    : creatorErrors[key];
  const initialLoading = socialApiConfigured
    ? creatorMarkets.isPending
    : !hasCachedResult && !error;
  const awaitingPool = tokens.some(
    (token) =>
      !token.graduated && (token.pending || (token.progress ?? 0) >= 100),
  );

  useEffect(() => {
    if (socialApiConfigured) return;
    void loadCreatorTokens(
      publicClient as unknown as CreatorTokenClient | undefined,
      address,
    ).catch(() => undefined);
  }, [address, loadCreatorTokens, publicClient]);

  useEffect(() => {
    if (socialApiConfigured || !awaitingPool) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadCreatorTokens(
          publicClient as unknown as CreatorTokenClient | undefined,
          address,
          { force: true },
        ).catch(() => undefined);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [address, awaitingPool, loadCreatorTokens, publicClient]);

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // The newest launch is open until the creator picks another tile.
  const sortedTokens = useMemo(
    () =>
      [...tokens].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [tokens],
  );
  const visibleTokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sortedTokens.filter(
        (token) =>
          !query ||
          `${token.name} ${token.symbol} ${token.address}`
            .toLowerCase()
            .includes(query),
      );
  }, [sortedTokens, search]);
  const selectedToken =
    sortedTokens.find(
      (token) => token.address.toLowerCase() === selectedAddress,
    ) ?? sortedTokens[0];

  return (
    <section className="creator-launch-dashboard" aria-label="Your launches">
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {initialLoading ? (
        <div
          className="launch-loading"
          aria-busy="true"
          aria-label="Loading launches"
        >
          <span className="skeleton launch-loading-header" />
          <span className="skeleton launch-loading-table" />
        </div>
      ) : !tokens.length ? (
        <div className="profile-empty-state">
          <strong>No launches yet</strong>
          <p>Tokens you create show up here with their holders.</p>
          <AppLink
            className="profile-secondary-action"
            route="launch"
            navigate={navigate}
          >
            Launch a token
          </AppLink>
        </div>
      ) : (
        <>
          {tokens.length > 12 ? (
            <div className="launch-toolbar">
              <label className="visually-hidden" htmlFor="profile-launch-search">
                Search launches
              </label>
              <input
                id="profile-launch-search"
                className="launch-search"
                type="search"
                placeholder="Search launches"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          ) : null}
          {visibleTokens.length ? (
            <LaunchGallery
              tokens={visibleTokens}
              selected={selectedToken?.address}
              onSelect={(token) =>
                setSelectedAddress(token.address.toLowerCase())
              }
            />
          ) : (
            <p className="launch-picker-empty">
              No launches match your search.
            </p>
          )}
          {selectedToken ? (
            <LaunchSummary token={selectedToken} />
          ) : null}
        </>
      )}
    </section>
  );
}

export function ProfilePage({
  navigate,
  initialTab,
}: {
  navigate: Navigate;
  initialTab?: ProfileTab;
}) {
  const { address } = useAccount();
  const { ready: privyReady, authenticated, login } = usePrivy();

  // On a refresh the Privy session restores asynchronously and wagmi's address
  // arrives only after the wallet sync finishes. Gate on both before showing
  // the sign-in screen, otherwise /dashboard flashes a login page at every load
  // and offers "Create account or sign in" while a session is already live.
  const view = selectProfileAuthView({
    ready: privyReady,
    authenticated,
    hasAddress: Boolean(address),
  });
  if (view === "loading" || view === "restoring") {
    return (
      <main
        className="page-main profile-page wrap"
        aria-busy="true"
        aria-label={
          view === "loading" ? "Loading dashboard" : "Restoring signed-in session"
        }
      >
        <div className="trader-profile-skeleton skeleton" />
      </main>
    );
  }

  if (view === "login" || !address || !authenticated) {
    return (
      <main className="page-main profile-page wrap">
        <h1 className="visually-hidden">Dashboard</h1>
        <section
          className="profile-connect"
          aria-labelledby="profile-connect-title"
        >
          <span className="profile-connect-icon" aria-hidden="true">
            <InlineArrow />
          </span>
          <h2 id="profile-connect-title">Connect your wallet</h2>
          <p>
            See your trading profile and the tokens you created on Curveball.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={!privyReady}
            onClick={login}
          >
            Create account or sign in
          </button>
        </section>
      </main>
    );
  }

  return (
    <Suspense fallback={<TraderProfileSkeleton />}>
      <TraderProfilePage
        address={address}
        navigate={navigate}
        {...(initialTab ? { initialTab } : {})}
        launches={
          <CreatorLaunchDashboard address={address} navigate={navigate} />
        }
      />
    </Suspense>
  );
}

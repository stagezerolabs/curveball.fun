import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "@base-ui/react/tabs";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { CreatorTokenInsights } from "../components/CreatorTokenInsights";
import { HolderAirdropPanel } from "../components/HolderAirdropPanel";
import { TokenAvatar } from "../components/TokenAvatar";
import { UsdAmount } from "../components/UsdAmount";
import type { CreatorTokenClient } from "../creatorTokens";
import { formatRelativeTime } from "../lib/format.js";
import { getMarketDisplayStatus } from "../lib/marketState";
import { fetchCreatorMarkets } from "../markets/api";
import { socialApiConfigured } from "../social/api";
import { activeChainId } from "../lib/web3";
import type { Navigate, Token } from "../types";
import type { ProfileTab } from "./TraderProfilePage";
import { selectProfileAuthView } from "./profileAuthGate";

type LaunchFilter = "all" | "live" | "ready" | "graduated";
type ProfileSection = "holders" | "airdrops";

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

  const counts = useMemo(
    () => ({
      live: tokens.filter(
        (token) => getMarketDisplayStatus(token).kind === "live",
      ).length,
      ready: tokens.filter(
        (token) => getMarketDisplayStatus(token).kind === "ready",
      ).length,
      graduated: tokens.filter((token) => token.graduated).length,
    }),
    [tokens],
  );
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ProfileSection>("holders");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LaunchFilter>("all");
  const visibleTokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...tokens]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .filter(
        (token) =>
          (filter === "all" || getMarketDisplayStatus(token).kind === filter) &&
          (!query ||
            `${token.name} ${token.symbol} ${token.address}`
              .toLowerCase()
              .includes(query)),
      );
  }, [tokens, search, filter]);
  const selectedToken =
    visibleTokens.find(
      (token) => token.address.toLowerCase() === selectedAddress,
    ) ?? visibleTokens[0];

  const filters = (
    [
      ["all", "All", tokens.length],
      ["live", "Live", counts.live],
      ["ready", "Bonding complete", counts.ready],
      ["graduated", "Graduated", counts.graduated],
    ] as const
  ).filter(([value, , count]) => value === "all" || count > 0);

  return (
    <section className="creator-launch-dashboard" aria-label="Your launches">
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {initialLoading ? (
        <div
          className="profile-dashboard-loading"
          aria-busy="true"
          aria-label="Loading launches"
        >
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : !tokens.length ? (
        <div className="profile-empty-state">
          <strong>No launches yet</strong>
          <p>Tokens you create show up here with their holders and reserve.</p>
          <AppLink
            className="profile-secondary-action"
            route="launch"
            navigate={navigate}
          >
            Launch a token
          </AppLink>
        </div>
      ) : (
        <div className="profile-dashboard">
          <aside className="profile-launch-directory" aria-label="Launches">
            {tokens.length > 1 ? (
              <div className="profile-directory-controls">
                {tokens.length > 6 ? (
                  <>
                    <label
                      className="visually-hidden"
                      htmlFor="profile-launch-search"
                    >
                      Search launches
                    </label>
                    <input
                      id="profile-launch-search"
                      type="search"
                      placeholder="Search launches"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </>
                ) : null}
                {filters.length > 2 ? (
                  <div
                    className="profile-status-filters"
                    role="group"
                    aria-label="Filter launches by status"
                  >
                    {filters.map(([value, label, count]) => (
                      <button
                        key={value}
                        type="button"
                        className={
                          filter === value
                            ? "profile-status-filter active"
                            : "profile-status-filter"
                        }
                        aria-pressed={filter === value}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                        <span>{count}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {visibleTokens.length ? (
              <ul className="profile-launch-list">
                {visibleTokens.map((token, index) => {
                  const status = getMarketDisplayStatus(token);
                  return (
                    <li key={token.address}>
                      <button
                        type="button"
                        className={
                          selectedToken?.address === token.address
                            ? "profile-launch-item selected"
                            : "profile-launch-item"
                        }
                        aria-pressed={selectedToken?.address === token.address}
                        onClick={() =>
                          setSelectedAddress(token.address.toLowerCase())
                        }
                      >
                        <TokenAvatar
                          token={token}
                          index={index}
                          className="profile-launch-avatar"
                        />
                        <span className="profile-launch-item-copy">
                          <strong>{token.name}</strong>
                          <small>
                            ${token.symbol} ·{" "}
                            {formatRelativeTime(token.createdAt)}
                          </small>
                        </span>
                        <span
                          className={`profile-launch-status ${status.kind}`}
                        >
                          {status.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="profile-directory-empty">
                No launches match your search or filter.
              </p>
            )}
          </aside>

          <div className="profile-detail" aria-live="polite">
            {selectedToken ? (
              <>
                <header className="profile-token-header">
                  <div className="profile-token-identity">
                    <TokenAvatar
                      token={selectedToken}
                      className="profile-token-avatar"
                    />
                    <div>
                      <h3>{selectedToken.name}</h3>
                      <p>
                        <span>${selectedToken.symbol}</span>
                        <span>
                          MC{" "}
                          <UsdAmount weth={selectedToken.marketCap} compact />
                        </span>
                        <span>
                          Launched {formatRelativeTime(selectedToken.createdAt)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="profile-token-actions">
                    <AppLink
                      className="profile-market-link"
                      route="market"
                      params={{ address: selectedToken.address }}
                      navigate={navigate}
                    >
                      View market <span aria-hidden="true">↗</span>
                    </AppLink>
                  </div>
                </header>
                <Tabs.Root
                  value={activeSection}
                  onValueChange={(value) =>
                    setActiveSection(value as ProfileSection)
                  }
                >
                  <Tabs.List
                    className="profile-section-nav profile-subnav"
                    aria-label="Selected token view"
                  >
                    <Tabs.Tab
                      value="holders"
                      className={activeSection === "holders" ? "active" : ""}
                    >
                      Holders
                    </Tabs.Tab>
                    <Tabs.Tab
                      value="airdrops"
                      className={activeSection === "airdrops" ? "active" : ""}
                    >
                      Holder reserve
                    </Tabs.Tab>
                    <Tabs.Indicator className="profile-section-indicator" />
                  </Tabs.List>
                  <Tabs.Panel
                    key={`${selectedToken.address}-${activeSection}`}
                    value={activeSection}
                    className="profile-token-workspace profile-section-panel"
                  >
                    {activeSection === "holders" ? (
                      <CreatorTokenInsights
                        token={selectedToken}
                        navigate={navigate}
                      />
                    ) : (
                      <HolderAirdropPanel token={selectedToken} />
                    )}
                  </Tabs.Panel>
                </Tabs.Root>
              </>
            ) : (
              <p className="profile-directory-empty">
                Choose a launch to view its details.
              </p>
            )}
          </div>
        </div>
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
  // the sign-in screen, otherwise /profile flashes a login page at every load
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
          view === "loading" ? "Loading profile" : "Restoring signed-in session"
        }
      >
        <div className="trader-profile-skeleton skeleton" />
      </main>
    );
  }

  if (view === "login" || !address || !authenticated) {
    return (
      <main className="page-main profile-page wrap">
        <h1 className="visually-hidden">Profile</h1>
        <section
          className="profile-connect"
          aria-labelledby="profile-connect-title"
        >
          <span className="profile-connect-icon" aria-hidden="true">
            ↗
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
    <Suspense
      fallback={
        <main
          className="trader-profile-page wrap"
          aria-busy="true"
          aria-label="Loading profile"
        >
          <div className="trader-profile-skeleton skeleton" />
        </main>
      }
    >
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

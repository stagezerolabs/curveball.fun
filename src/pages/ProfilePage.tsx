import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
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
import { formatAddress, formatRelativeTime } from "../lib/format.js";
import { getMarketDisplayStatus } from "../lib/marketState";
import { activeChainId, activeExplorerUrl } from "../lib/web3";
import type { Navigate, Token } from "../types";

type LaunchFilter = "all" | "live" | "ready" | "graduated";
type ProfileSection = "holders" | "airdrops";

const TraderProfilePage = lazy(() => import("./TraderProfilePage").then((module) => ({ default: module.TraderProfilePage })));

function CreatorLaunchDashboard({ address, navigate }: { address: Address; navigate: Navigate }) {
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
  const hasCachedResult = Object.prototype.hasOwnProperty.call(creatorTokens, key);
  const tokens = creatorTokens[key] ?? [];
  const error = creatorErrors[key];
  const initialLoading = !hasCachedResult && !error;
  const awaitingPool = tokens.some((token) => !token.graduated && (token.pending || (token.progress ?? 0) >= 100));

  useEffect(() => {
    void loadCreatorTokens(publicClient as unknown as CreatorTokenClient | undefined, address).catch(() => undefined);
  }, [address, loadCreatorTokens, publicClient]);

  useEffect(() => {
    if (!awaitingPool) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadCreatorTokens(publicClient as unknown as CreatorTokenClient | undefined, address, { force: true }).catch(() => undefined);
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [address, awaitingPool, loadCreatorTokens, publicClient]);

  const counts = useMemo(() => ({
    live: tokens.filter((token) => getMarketDisplayStatus(token).kind === "live").length,
    ready: tokens.filter((token) => getMarketDisplayStatus(token).kind === "ready").length,
    graduated: tokens.filter((token) => token.graduated).length,
  }), [tokens]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ProfileSection>("holders");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LaunchFilter>("all");
  const visibleTokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...tokens]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .filter((token) => (filter === "all" || getMarketDisplayStatus(token).kind === filter) &&
        (!query || `${token.name} ${token.symbol} ${token.address}`.toLowerCase().includes(query)));
  }, [tokens, search, filter]);
  const selectedToken = visibleTokens.find((token) => token.address.toLowerCase() === selectedAddress) ?? visibleTokens[0];

  return <section className="profile-page creator-launch-dashboard" aria-labelledby="creator-launches-title">
    <header className="creator-launch-heading">
      <div><p>Creator portfolio</p><h2 id="creator-launches-title">Created tokens</h2></div>
      <span>{counts.graduated} graduated</span>
    </header>

    {initialLoading ? <section className="profile-stats profile-stats-skeleton" aria-busy="true" aria-label="Loading launch summary">
      {Array.from({ length: 4 }, (_, index) => <div key={index}><span className="skeleton skeleton-line" /><span className="skeleton skeleton-number" /></div>)}
    </section> : <dl className="profile-stats" aria-label="Launch summary">
      <div><dt>Launched</dt><dd>{tokens.length}</dd></div>
      <div><dt>Live</dt><dd>{counts.live}</dd></div>
      <div><dt>Bonding complete</dt><dd>{counts.ready}</dd></div>
      <div><dt>Graduated</dt><dd>{counts.graduated}</dd></div>
    </dl>}

    {error && <p className="notice" role="alert">{error}</p>}
    {initialLoading ? <div className="profile-dashboard-loading" aria-busy="true" aria-label="Loading launches"><div className="skeleton" /><div className="skeleton" /></div> : !tokens.length ? <section className="profile-empty">
      <strong>No launches from this wallet yet.</strong>
      <p>Tokens you create will appear here.</p>
      <AppLink className="primary-button" route="launch" navigate={navigate}>Launch a token</AppLink>
    </section> : <div className="profile-dashboard">
      <aside className="profile-launch-directory" aria-labelledby="profile-launch-list-title">
        <div className="profile-directory-heading"><h3 id="profile-launch-list-title">Launches</h3><span>{visibleTokens.length} / {tokens.length}</span></div>
        <div className="profile-directory-controls">
          <label className="visually-hidden" htmlFor="profile-launch-search">Search launches</label>
          <input id="profile-launch-search" type="search" placeholder="Search launches" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="profile-status-filters" role="group" aria-label="Filter launches by status">
            {([["all", "All", tokens.length], ["live", "Live", counts.live], ["ready", "Bonding complete", counts.ready], ["graduated", "Graduated", counts.graduated]] as const).map(([value, label, count]) => <button key={value} type="button" className={filter === value ? "profile-status-filter active" : "profile-status-filter"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}
          </div>
        </div>
        {visibleTokens.length ? <ul className="profile-launch-list">{visibleTokens.map((token, index) => {
          const status = getMarketDisplayStatus(token);
          return <li key={token.address}><button type="button" className={selectedToken?.address === token.address ? "profile-launch-item selected" : "profile-launch-item"} aria-pressed={selectedToken?.address === token.address} onClick={() => setSelectedAddress(token.address.toLowerCase())}>
            <TokenAvatar token={token} index={index} className="profile-launch-avatar" />
            <span className="profile-launch-item-copy"><strong>{token.name}</strong><small>${token.symbol} · {formatRelativeTime(token.createdAt)}</small></span>
            <span className={`profile-launch-status ${status.kind}`}>{status.label}</span>
          </button></li>;
        })}</ul> : <p className="profile-directory-empty">No launches match your search or filter.</p>}
      </aside>

      <div className="profile-detail" aria-live="polite">
        {selectedToken ? <>
          <header className="profile-token-header">
            <div className="profile-token-identity"><TokenAvatar token={selectedToken} className="profile-token-avatar" /><div><h3>{selectedToken.name}</h3><p>${selectedToken.symbol} <span aria-hidden="true">·</span> <a className="profile-token-address" href={`${activeExplorerUrl}/address/${selectedToken.address}`} target="_blank" rel="noreferrer" title={selectedToken.address} aria-label={`View ${selectedToken.name} token address ${selectedToken.address} on explorer`}>{formatAddress(selectedToken.address)} <span aria-hidden="true">↗</span></a></p></div></div>
            <div className="profile-token-actions"><span className={`profile-launch-status ${getMarketDisplayStatus(selectedToken).kind}`}>{getMarketDisplayStatus(selectedToken).label}</span><AppLink className="profile-market-link" route="market" params={{ address: selectedToken.address }} navigate={navigate}>View market <span aria-hidden="true">↗</span></AppLink></div>
          </header>
          <dl className="profile-token-facts"><div><dt>Market cap</dt><dd><UsdAmount weth={selectedToken.marketCap} /></dd></div><div><dt>Stage</dt><dd>{getMarketDisplayStatus(selectedToken).label}</dd></div><div><dt>Launched</dt><dd>{formatRelativeTime(selectedToken.createdAt)}</dd></div></dl>
          <Tabs.Root value={activeSection} onValueChange={(value) => setActiveSection(value as ProfileSection)}>
            <Tabs.List className="profile-section-nav" aria-label="Selected token view">
              <Tabs.Tab value="holders" className={activeSection === "holders" ? "active" : ""}>Holders</Tabs.Tab>
              <Tabs.Tab value="airdrops" className={activeSection === "airdrops" ? "active" : ""}>Holder reserve</Tabs.Tab>
              <Tabs.Indicator className="profile-section-indicator" />
            </Tabs.List>
            <Tabs.Panel key={`${selectedToken.address}-${activeSection}`} value={activeSection} className="profile-token-workspace profile-section-panel">
              {activeSection === "holders" ? <CreatorTokenInsights token={selectedToken} /> : <HolderAirdropPanel token={selectedToken} />}
            </Tabs.Panel>
          </Tabs.Root>
        </> : <p className="profile-directory-empty">Choose a launch to view its details.</p>}
      </div>
    </div>}
  </section>;
}

export function ProfilePage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const { ready: privyReady, login } = usePrivy();

  if (!address) {
    return <main className="page-main profile-page wrap">
      <h1 className="visually-hidden">Profile</h1>
      <section className="profile-connect" aria-labelledby="profile-connect-title">
        <span className="profile-connect-icon" aria-hidden="true">↗</span>
        <h2 id="profile-connect-title">Connect your wallet</h2>
        <p>See your trading profile and the tokens you created on Curveball.</p>
        <button className="primary-button" type="button" disabled={!privyReady} onClick={login}>Create account or sign in</button>
      </section>
    </main>;
  }

  return <Suspense fallback={<main className="trader-profile-page wrap" aria-busy="true" aria-label="Loading profile"><div className="trader-profile-skeleton skeleton" /></main>}>
    <TraderProfilePage
      address={address}
      navigate={navigate}
      launches={<CreatorLaunchDashboard address={address} navigate={navigate} />}
    />
  </Suspense>;
}

import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { Featured } from "../components/Featured";
import { MarketList } from "../components/MarketList";
import { useStore } from "../app/useStore.js";
import type { CreatorTokenClient } from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import { useMarketPreviewStats } from "../lib/useMarketPreviewStats";
import type { MarketPreviewStatsByToken, MarketPreviewStatsClient } from "../lib/marketPreviewStats";
import type { Navigate, Token } from "../types";

type MarketFilter = "all" | "curve" | "graduated";
type MarketSort = "market-cap" | "new" | "trending" | "volume-24h";

const filters: { id: MarketFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "curve", label: "On the curve" },
  { id: "graduated", label: "Graduated" },
];

function sortMarkets(tokens: Token[], sort: MarketSort, stats: MarketPreviewStatsByToken) {
  return [...tokens].sort((a, b) => {
    const aStats = stats[a.address.toLowerCase()];
    const bStats = stats[b.address.toLowerCase()];
    let difference = 0;
    switch (sort) {
      case "new": difference = Date.parse(b.createdAt) - Date.parse(a.createdAt); break;
      case "trending": difference = (bStats?.change24h ?? -Infinity) - (aStats?.change24h ?? -Infinity); break;
      case "volume-24h": difference = (bStats?.volume24h ?? -1) - (aStats?.volume24h ?? -1); break;
      default: difference = (b.marketCap ?? -1) - (a.marketCap ?? -1);
    }
    return difference || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function MarketsPage({ navigate }: { navigate: Navigate }) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const {
    tokens,
    loading,
    marketsFetchedAt,
    marketError: error,
    lastCreatedToken,
    loadMarkets,
  } = useStore() as {
    tokens: Token[];
    marketsFetchedAt: number;
    marketError: string;
    lastCreatedToken: string | null;
    loading: boolean;
    loadMarkets: (client?: CreatorTokenClient, options?: { force?: boolean }) => Promise<Token[]>;
  };
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [sort, setSort] = useState<MarketSort>(lastCreatedToken ? "new" : "market-cap");
  const [view, setView] = useState<"cards" | "rows">("cards");
  const [search, setSearch] = useState("");
  const previewStats = useMarketPreviewStats(
    publicClient as unknown as MarketPreviewStatsClient | undefined,
    tokens,
    marketsFetchedAt,
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = tokens.filter((token) => {
      if (filter === "curve" && token.graduated) return false;
      if (filter === "graduated" && !token.graduated) return false;
      return !query || token.name.toLowerCase().includes(query)
        || token.symbol.toLowerCase().includes(query)
        || token.address.toLowerCase().includes(query);
    });
    return sortMarkets(filtered, sort, previewStats);
  }, [tokens, filter, search, sort, previewStats]);
  const initialLoading = !marketsFetchedAt && !tokens.length && !error;
  const awaitingPool = tokens.some((token) => !token.graduated && (token.pending || (token.progress ?? 0) >= 100));

  useEffect(() => {
    const client = publicClient as unknown as CreatorTokenClient | undefined;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadMarkets(client).catch(() => undefined);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadMarkets, publicClient]);

  useEffect(() => {
    if (!awaitingPool) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadMarkets(publicClient as unknown as CreatorTokenClient | undefined, { force: true }).catch(() => undefined);
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [awaitingPool, loadMarkets, publicClient]);

  return (
    <main className="page-main">
      <section className="markets-page wrap" aria-labelledby="markets-title">
        <h1 id="markets-title" className="visually-hidden">Explore markets</h1>
        {lastCreatedToken && <p className="market-created-note" role="status">Your new token is listed below. Market data may take a moment to appear.</p>}
        {error && <p className="notice" role="alert">{error}</p>}
        <Featured tokens={tokens} loading={initialLoading} navigate={navigate} />
        <div className="market-directory-controls">
          <label className="market-search">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <span className="visually-hidden">Search markets by name, ticker, or address</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ticker or mint" />
          </label>
          <div className="market-filter-group" role="group" aria-label="Market status">
            {filters.map((item) => <button key={item.id} type="button" className={filter === item.id ? "active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
          </div>
          <div className="market-directory-actions">
            <label className="market-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as MarketSort)}>
              <option value="market-cap">Market cap</option>
              <option value="new">New</option>
              <option value="trending">Trending</option>
              <option value="volume-24h">Volume 24h</option>
            </select></label>
            <div className="market-view-switch" role="group" aria-label="Market view">
              <button type="button" aria-pressed={view === "cards"} className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1" /><rect x="11.5" y="2.5" width="6" height="6" rx="1" /><rect x="2.5" y="11.5" width="6" height="6" rx="1" /><rect x="11.5" y="11.5" width="6" height="6" rx="1" /></svg>
                Cards
              </button>
              <button type="button" aria-pressed={view === "rows"} className={view === "rows" ? "active" : ""} onClick={() => setView("rows")}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 4h2M8 4h9M3 10h2m3 0h9M3 16h2m3 0h9" /></svg>
                Rows
              </button>
            </div>
            <button type="button" className="market-refresh" onClick={() => void loadMarkets(publicClient as unknown as CreatorTokenClient | undefined, { force: true }).catch(() => undefined)} disabled={loading || !publicClient} aria-label={loading ? "Refreshing markets" : "Refresh markets"} aria-busy={loading} title="Refresh markets">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 8A7 7 0 1 0 17 11" /><path d="M17 3.5V8h-4.5" /></svg>
            </button>
          </div>
        </div>
        <MarketList tokens={visible} loading={initialLoading} navigate={navigate} highlightedToken={lastCreatedToken} previewStats={previewStats} view={view} />
      </section>
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { Featured } from "../components/Featured";
import { MarketList } from "../components/MarketList";
import { TokenCard } from "../components/TokenCard";
import { useStore } from "../app/useStore.js";
import type { CreatorTokenClient } from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import type { Navigate, Token } from "../types";

type Tab = "trending" | "new" | "graduated";
type Sort = "newest" | "oldest" | "progress";
type View = "grid" | "list";

const TABS: { id: Tab; label: string; sort: Sort }[] = [
  { id: "trending", label: "Trending", sort: "progress" },
  { id: "new", label: "New", sort: "newest" },
  { id: "graduated", label: "Graduated", sort: "newest" },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "progress", label: "Progress" },
];

const SKELETON_CARDS = 6;

const byNewest = (a: Token, b: Token) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

function sortTokens(tokens: Token[], sort: Sort) {
  const list = [...tokens];
  if (sort === "oldest") return list.sort((a, b) => byNewest(b, a));
  if (sort === "progress")
    return list.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));
  return list.sort(byNewest);
}

function GraduateIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3 18 7l-8 4-8-4 8-4Z" />
      <path d="M5.5 9v4.5c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V9" />
    </svg>
  );
}

function ViewIcon({ view }: { view: View }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {view === "grid" ? (
        <>
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="11" y="3" width="6" height="6" rx="1.5" />
          <rect x="3" y="11" width="6" height="6" rx="1.5" />
          <rect x="11" y="11" width="6" height="6" rx="1.5" />
        </>
      ) : (
        <>
          <path d="M7 5h10M7 10h10M7 15h10" />
          <circle cx="3.5" cy="5" r="1" />
          <circle cx="3.5" cy="10" r="1" />
          <circle cx="3.5" cy="15" r="1" />
        </>
      )}
    </svg>
  );
}

export function HomePage({ navigate }: { navigate: Navigate }) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const { tokens, marketsFetchedAt, marketError, loadMarkets } = useStore() as {
    tokens: Token[];
    marketsFetchedAt: number;
    marketError: string;
    loadMarkets: (client?: CreatorTokenClient) => Promise<Token[]>;
  };
  const [tab, setTab] = useState<Tab>("trending");
  const [sort, setSort] = useState<Sort>("progress");
  const [view, setView] = useState<View>("grid");
  const initialLoading = !marketsFetchedAt && !marketError;

  useEffect(() => {
    void loadMarkets(
      publicClient as unknown as CreatorTokenClient | undefined,
    ).catch(() => undefined);
  }, [loadMarkets, publicClient]);

  const listed = useMemo(() => {
    const set =
      tab === "graduated"
        ? tokens.filter((token) => token.graduated)
        : tokens.filter((token) => !token.graduated);
    return sortTokens(set, sort);
  }, [tokens, tab, sort]);

  function selectTab(next: Tab) {
    setTab(next);
    setSort(TABS.find((item) => item.id === next)?.sort ?? "newest");
  }

  return (
    <main className="launchpad wrap">
      {marketError && (
        <p className="notice" role="alert">
          {marketError}
        </p>
      )}

      <Featured tokens={tokens} loading={initialLoading} navigate={navigate} />

      <section className="board" aria-label="All markets">
        <header className="board-head">
          <div className="board-tabs" role="tablist" aria-label="Market filter">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls="board-panel"
                className={tab === item.id ? "active" : ""}
                onClick={() => selectTab(item.id)}
              >
                {item.id === "graduated" && <GraduateIcon />}
                {item.label}
              </button>
            ))}
          </div>

          <div className="board-controls">
            <label className="board-sort">
              <span className="visually-hidden">Sort markets by</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                {SORTS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="board-view" role="group" aria-label="Layout">
              {(["grid", "list"] as View[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={view === item ? "active" : ""}
                  aria-pressed={view === item}
                  aria-label={`${item === "grid" ? "Grid" : "List"} view`}
                  onClick={() => setView(item)}
                >
                  <ViewIcon view={item} />
                </button>
              ))}
            </div>
          </div>
        </header>

        <div id="board-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {initialLoading ? (
            <ul className="tcard-grid" aria-busy="true">
              {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                <li key={index} className="tcard skeleton" />
              ))}
            </ul>
          ) : !listed.length ? (
            <p className="board-empty">
              {tab === "graduated"
                ? "No curve has graduated yet."
                : "No live curves right now."}
            </p>
          ) : view === "grid" ? (
            <ul className="tcard-grid">
              {listed.map((token, index) => (
                <TokenCard
                  key={token.address}
                  token={token}
                  index={index}
                  navigate={navigate}
                />
              ))}
            </ul>
          ) : (
            <MarketList tokens={listed} loading={false} navigate={navigate} />
          )}
        </div>
      </section>
    </main>
  );
}

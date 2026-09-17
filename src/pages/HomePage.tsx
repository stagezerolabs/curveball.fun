import { useMemo, useState } from "react";
import { ArrowIcon } from "../components/ArrowIcon";
import { AppLink } from "../components/Navigation";
import { TokenCard } from "../components/TokenCard";
import { useStore } from "../app/useStore.js";
import type { Navigate, Token } from "../types";

const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "cap", label: "Market cap" },
  { id: "progress", label: "Progress" },
];

type Sort = "newest" | "oldest" | "cap" | "progress";

const byNewest = (a: Token, b: Token) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

function sortTokens(tokens: Token[], sort: Sort) {
  const list = [...tokens];
  if (sort === "oldest") return list.sort((a, b) => byNewest(b, a));
  if (sort === "cap")
    return list.sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));
  if (sort === "progress")
    return list.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));
  return list.sort(byNewest);
}

function Panel({
  id,
  title,
  copy,
  tokens,
  sort,
  onSort,
  navigate,
  loading,
}: {
  id: string;
  title: string;
  copy: string;
  tokens: Token[];
  sort?: Sort;
  onSort?: (sort: Sort) => void;
  navigate: Navigate;
  loading: boolean;
}) {
  return (
    <section className={`launch-explore ${id}`} aria-labelledby={`${id}-title`}>
      <header className="launch-explore-head">
        <div>
          <div className="launch-explore-title-row">
            <h2 id={`${id}-title`}>{title}</h2>
            <span className="launch-explore-count">
              {loading ? "—" : tokens.length}
            </span>
          </div>
          <p>{copy}</p>
        </div>
        {onSort && (
          <div
            className="launch-explore-sorts"
            role="tablist"
            aria-label="Sort"
          >
            {SORTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={sort === item.id}
                className={sort === item.id ? "active" : ""}
                onClick={() => onSort(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </header>
      {loading ? (
        <p className="launch-explore-empty">Loading the latest curves…</p>
      ) : tokens.length ? (
        <ul className="launch-explore-grid">
          {tokens.map((token, index) => (
            <TokenCard
              key={token.address}
              token={token}
              index={index}
              navigate={navigate}
            />
          ))}
        </ul>
      ) : (
        <p className="launch-explore-empty">Nothing here yet.</p>
      )}
    </section>
  );
}

export function HomePage({ navigate }: { navigate: Navigate }) {
  const { tokens, loading, marketError } = useStore() as {
    tokens: Token[];
    loading: boolean;
    marketError: string;
  };
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tokens;
    return tokens.filter((token) =>
      `${token.name} ${token.symbol} ${token.address}`
        .toLowerCase()
        .includes(needle),
    );
  }, [tokens, query]);

  const graduated = useMemo(
    () =>
      sortTokens(
        matched.filter((token) => token.graduated),
        "cap",
      ),
    [matched],
  );
  const live = useMemo(
    () =>
      sortTokens(
        matched.filter((token) => !token.graduated),
        sort,
      ),
    [matched, sort],
  );

  return (
    <main className="launchpad wrap">
      <header className="launch-toolbar">
        <label className="launch-search">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="9" cy="9" r="6" />
            <path d="M13.5 13.5 17 17" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tokens by name, symbol or address"
            aria-label="Search tokens"
          />
        </label>
        <AppLink className="primary-button" route="launch" navigate={navigate}>
          Create <ArrowIcon />
        </AppLink>
      </header>

      {marketError && (
        <p className="notice" role="alert">
          {marketError}
        </p>
      )}

      <Panel
        id="graduated"
        title="Graduated"
        copy="Curves that completed. Liquidity has moved to Icarus."
        tokens={graduated}
        navigate={navigate}
        loading={loading}
      />
      <Panel
        id="live"
        title="On the curve"
        copy="Live bonding curves still climbing toward graduation."
        tokens={live}
        sort={sort}
        onSort={setSort}
        navigate={navigate}
        loading={loading}
      />
    </main>
  );
}

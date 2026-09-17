import { useMemo, useState } from "react";
import { MarketList } from "../components/MarketList.jsx";
import { useStore } from "../app/useStore.js";

const TABS = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "graduated", label: "Graduated" },
];

function selectTokens(tokens, tab) {
  if (tab === "graduated") return tokens.filter((token) => token.graduated);
  if (tab === "new") {
    return [...tokens].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
  }
  return [...tokens].sort(
    (a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1),
  );
}

export function MarketsPage({ navigate }) {
  const { tokens, loading, marketError: error } = useStore();
  const [tab, setTab] = useState("trending");
  const visible = useMemo(() => selectTokens(tokens, tab), [tokens, tab]);

  return (
    <main className="page-main">
      <section className="page-heading wrap">
        <div className="eyebrow">
          <span /> Discover
        </div>
        <h1>Markets in motion</h1>
        <p>
          Pick a live bonding curve to trade, or follow graduated tokens into
          open liquidity.
        </p>
      </section>
      <section className="markets-page wrap">
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="market-tabs" role="tablist" aria-label="Market filters">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <MarketList tokens={visible} loading={loading} navigate={navigate} />
      </section>
    </main>
  );
}

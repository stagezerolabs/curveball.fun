import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { MarketList } from "../components/MarketList";
import { useStore } from "../app/useStore.js";
import type { CreatorTokenClient } from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import type { Navigate, Token } from "../types";

const TABS: { id: Tab; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "graduated", label: "Graduated" },
];

type Tab = "trending" | "new" | "graduated";

function selectTokens(tokens: Token[], tab: Tab) {
  if (tab === "graduated") return tokens.filter((token) => token.graduated);
  if (tab === "new") {
    return [...tokens].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return [...tokens].sort(
    (a, b) => (b.progress ?? -1) - (a.progress ?? -1),
  );
}

export function MarketsPage({ navigate }: { navigate: Navigate }) {
  const publicClient = usePublicClient({ chainId: activeChainId });
  const {
    tokens,
    marketsFetchedAt,
    marketError: error,
    lastCreatedToken,
    loadMarkets,
  } = useStore() as {
    tokens: Token[];
    marketsFetchedAt: number;
    marketError: string;
    lastCreatedToken: string | null;
    loadMarkets: (client?: CreatorTokenClient) => Promise<Token[]>;
  };
  const [tab, setTab] = useState<Tab>(lastCreatedToken ? "new" : "trending");
  const visible = useMemo(() => selectTokens(tokens, tab), [tokens, tab]);
  const initialLoading = !marketsFetchedAt && !error;

  useEffect(() => {
    void loadMarkets(
      publicClient as unknown as CreatorTokenClient | undefined,
    ).catch(() => undefined);
  }, [loadMarkets, publicClient]);

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
        {lastCreatedToken && <p className="market-created-note" role="status">Your new token is listed below. Market data may take a moment to appear.</p>}
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
        <MarketList tokens={visible} loading={initialLoading} navigate={navigate} highlightedToken={lastCreatedToken} />
      </section>
    </main>
  );
}

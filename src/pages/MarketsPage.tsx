import { useEffect, useMemo, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { usePublicClient } from "wagmi";
import { Featured } from "../components/Featured";
import { MarketList } from "../components/MarketList";
import { UsdAmount } from "../components/UsdAmount";
import { formatPercent } from "../lib/format.js";
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
  const tickerTokens = useMemo(() => selectTokens(tokens, "new").slice(0, 12), [tokens]);
  const initialLoading = !marketsFetchedAt && !error;

  useEffect(() => {
    void loadMarkets(
      publicClient as unknown as CreatorTokenClient | undefined,
    ).catch(() => undefined);
  }, [loadMarkets, publicClient]);

  return (
    <main className="page-main">
      <section className="markets-page wrap" aria-labelledby="markets-title">
        <h1 id="markets-title" className="visually-hidden">Explore markets</h1>
        {lastCreatedToken && <p className="market-created-note" role="status">Your new token is listed below. Market data may take a moment to appear.</p>}
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <Featured tokens={tokens} loading={initialLoading} navigate={navigate} />
        <Tabs.Root value={tab} onValueChange={(next) => setTab(next as Tab)}>
        <Tabs.List className="market-tabs" aria-label="Market filters">
          {TABS.map((item) => (
            <Tabs.Tab
              key={item.id}
              value={item.id}
              className={tab === item.id ? "active" : ""}
            >
              {item.label}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator className="market-tabs-indicator" />
        </Tabs.List>
        <Tabs.Panel key={tab} value={tab} className="market-tab-panel">
        <MarketList tokens={visible} loading={initialLoading} navigate={navigate} highlightedToken={lastCreatedToken} />
        </Tabs.Panel>
        </Tabs.Root>
      </section>
      {tickerTokens.length > 0 && (
        <aside className="market-snapshot-ticker" aria-label="Latest market snapshots">
          <div className="market-snapshot-track">
            {[0, 1].map((copy) => (
              <div className="market-snapshot-group" aria-hidden={copy === 1} key={copy}>
                {tickerTokens.map((token) => (
                  <span className="market-snapshot" key={token.address}>
                    <strong>${token.symbol}</strong>
                    <span><UsdAmount weth={token.marketCap} compact /> cap</span>
                    <span>{formatPercent(token.progress)} sold</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </aside>
      )}
    </main>
  );
}

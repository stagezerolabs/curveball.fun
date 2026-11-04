import { useEffect } from "react";
import { usePublicClient } from "wagmi";
import { useStore } from "../app/useStore.js";
import type { CreatorTokenClient } from "../creatorTokens";
import { formatEthAmount } from "../lib/format.js";
import { useCurveTapeStats } from "../lib/useCurveTapeStats";
import type { MarketPreviewStatsClient } from "../lib/marketPreviewStats";
import { useMarketPreviewStats } from "../lib/useMarketPreviewStats";
import { activeChainId } from "../lib/web3";
import type { Navigate, Token } from "../types";
import { MarketTape } from "./MarketTape";
import { AppLink } from "./Navigation";

const SNAPSHOT_SIZE = 4;

export function MarketTapeMarkets({ navigate }: { navigate: Navigate }) {
  const curveStats = useCurveTapeStats();
  const publicClient = usePublicClient({ chainId: activeChainId });
  const tokens = useStore((state: { tokens: Token[] }) => state.tokens);
  const marketsFetchedAt = useStore(
    (state: { marketsFetchedAt: number }) => state.marketsFetchedAt,
  );
  const marketError = useStore(
    (state: { marketError: string }) => state.marketError,
  );
  const loadMarkets = useStore(
    (state: { loadMarkets: (client?: CreatorTokenClient) => Promise<Token[]> }) =>
      state.loadMarkets,
  );
  const stats = useMarketPreviewStats(
    publicClient as MarketPreviewStatsClient | undefined,
    tokens,
    0,
    { refetchInterval: false, staleTime: 5 * 60_000 },
  );

  useEffect(() => {
    void loadMarkets(publicClient as CreatorTokenClient | undefined).catch(
      () => undefined,
    );
  }, [loadMarkets, publicClient]);

  const active = tokens
    .filter((token) => stats[token.address.toLowerCase()])
    .sort((a, b) => {
      const aVolume = stats[a.address.toLowerCase()].volume24h;
      const bVolume = stats[b.address.toLowerCase()].volume24h;
      return (
        bVolume - aVolume ||
        (b.marketCap ?? 0) - (a.marketCap ?? 0) ||
        a.address.localeCompare(b.address)
      );
    })
    .slice(0, SNAPSHOT_SIZE);

  return (
    <MarketTape
      curveStats={curveStats}
      renderMarkets={(interactive) => (
        <>
          <span className="market-snapshot market-snapshot-section">
            <strong>Top markets</strong>
            <small>24h</small>
          </span>
          {active.length ? (
            active.map((token) => {
              const preview = stats[token.address.toLowerCase()];
              const change = preview.change24h;
              const roundedChange =
                change == null ? null : Math.round(change * 10) / 10;
              const content = (
                <>
                  <span className="market-snapshot-symbol">${token.symbol}</span>
                  <strong className="market-snapshot-volume">
                    {formatEthAmount(preview.volume24h)} <small>WETH</small>
                  </strong>
                  <span
                    className={
                      roundedChange == null
                        ? "market-snapshot-change"
                        : roundedChange > 0
                          ? "market-snapshot-change up"
                          : roundedChange < 0
                            ? "market-snapshot-change down"
                            : "market-snapshot-change"
                    }
                  >
                    {roundedChange == null
                      ? "—"
                      : `${roundedChange > 0 ? "+" : ""}${roundedChange.toFixed(1)}%`}
                  </span>
                </>
              );
              return interactive ? (
                <AppLink
                  className="market-snapshot market-snapshot-token"
                  route="market"
                  params={{ address: token.address }}
                  navigate={navigate}
                  title={`${token.name} · 24h volume and price change`}
                  key={token.address}
                >
                  {content}
                </AppLink>
              ) : (
                <span className="market-snapshot market-snapshot-token" key={token.address}>
                  {content}
                </span>
              );
            })
          ) : (
            <span className="market-snapshot market-snapshot-empty">
              {marketError
                ? "Snapshot unavailable"
                : tokens.length
                  ? "Snapshot loading…"
                  : marketsFetchedAt
                    ? "No markets yet"
                    : "Markets loading…"}
            </span>
          )}
        </>
      )}
    />
  );
}

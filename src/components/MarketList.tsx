import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatPercent } from "../lib/format.js";
import { getMarketDisplayStatus } from "../lib/marketState";
import type { MarketPreviewStats, MarketPreviewStatsByToken } from "../lib/marketPreviewStats";
import type { Navigate, Token } from "../types";

function formatAge(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, (Date.now() - timestamp) / 1_000);
  if (seconds >= 31_536_000) return `${Math.floor(seconds / 31_536_000)}y`;
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return "now";
}

function formatCount(value: number | undefined) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function MarketCapChange({ label, value }: { label: string; value: number | null | undefined }) {
  const trend = value == null || Math.abs(value) < 0.05 ? "neutral" : value > 0 ? "positive" : "negative";
  const display = value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  return <div className={`market-card-change ${trend}`}><dt>{label}</dt><dd>{display}</dd></div>;
}

function MarketFacts({ token, stats }: { token: Token; stats?: MarketPreviewStats }) {
  return (
    <dl className="market-card-facts" aria-label="Market activity">
      <div><dt>ATH</dt><dd><UsdAmount weth={stats?.athMarketCap} compact /></dd></div>
      <div><dt>24HR VOL</dt><dd><UsdAmount weth={stats?.volume24h} compact /></dd></div>
      <div><dt>AGE</dt><dd>{formatAge(token.createdAt)}</dd></div>
      <div><dt>TXNS</dt><dd>{formatCount(stats?.transactions)}</dd></div>
      <div><dt>TRADERS</dt><dd>{formatCount(stats?.traders)}</dd></div>
    </dl>
  );
}

export function MarketList({
  tokens,
  loading,
  navigate,
  highlightedToken,
  previewStats = {},
}: {
  tokens: Token[];
  loading: boolean;
  navigate: Navigate;
  highlightedToken?: string | null;
  previewStats?: MarketPreviewStatsByToken;
}) {
  return (
    <div className="market-list" aria-live="polite">
      {loading && (
        <div className="market-list-skeleton" aria-busy="true" aria-label="Loading markets">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="market-card-skeleton" key={index}>
              <span className="skeleton market-card-skeleton-image" />
              <span className="skeleton market-card-skeleton-line" />
              <span className="skeleton market-card-skeleton-line short" />
            </div>
          ))}
        </div>
      )}
      {!loading && !tokens.length && (
        <div className="empty-state">
          <span className="empty-orbit" aria-hidden="true" />
          <strong>The curve is wide open.</strong>
          <p>Be the first token to bend it.</p>
          <AppLink route="launch" navigate={navigate}>
            Launch the first market
          </AppLink>
        </div>
      )}
      {!loading && tokens.length > 0 && (
        <ul className="market-card-grid">
          {tokens.map((token, index) => (
            <li key={token.address}>
              <article
                className={`market-card ${highlightedToken?.toLowerCase() === token.address.toLowerCase() ? "market-card-created" : ""}`}
              >
                <AppLink
                  route="market"
                  params={{ address: token.address }}
                  navigate={navigate}
                  className="market-card-link"
                  aria-label={`View ${token.name} market`}
                >
                  <span className="visually-hidden">View {token.name} market</span>
                </AppLink>
                <span className="market-card-art">
                  <TokenAvatar token={token} index={index} />
                  <span className={`market-card-status ${getMarketDisplayStatus(token).kind}`}>
                    {getMarketDisplayStatus(token).label}
                  </span>
                </span>
                <span className="market-card-content">
                  <span className="market-card-overview">
                    <span className="market-card-identity">
                      <span className="market-card-identity-copy">
                        <strong className="market-card-name">{token.name}</strong>
                        <span className="market-card-symbol">${token.symbol}</span>
                      </span>
                    </span>
                    <dl className="market-card-primary-metrics" aria-label="Market cap">
                      <div><dt>MCAP</dt><dd><UsdAmount weth={token.marketCap} compact /></dd></div>
                    </dl>
                    <dl className="market-card-changes" aria-label="Market cap change">
                      <MarketCapChange label="1H" value={previewStats[token.address.toLowerCase()]?.change1h} />
                      <MarketCapChange label="6H" value={previewStats[token.address.toLowerCase()]?.change6h} />
                      <MarketCapChange label="24H" value={previewStats[token.address.toLowerCase()]?.change24h} />
                    </dl>
                  </span>
                  {highlightedToken?.toLowerCase() === token.address.toLowerCase() && <span className="market-new-tag">Just launched</span>}
                  <MarketFacts token={token} stats={previewStats[token.address.toLowerCase()]} />
                  <span className="market-card-progress-label">
                    <span>{token.graduated ? "Graduated" : "Curve sold"}</span>
                    <strong>{token.graduated ? "100%" : formatPercent(token.progress)}</strong>
                  </span>
                  <span className="market-card-progress" aria-hidden="true"><span style={{ width: token.graduated ? "100%" : formatPercent(token.progress) }} /></span>
                </span>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

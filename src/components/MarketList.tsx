import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatAddress } from "../lib/format.js";
import { formatMarketDate } from "../lib/marketDisplay";
import { getMarketDisplayStatus } from "../lib/marketState";
import type { MarketPreviewStatsByToken } from "../lib/marketPreviewStats";
import type { Navigate, Token } from "../types";

function formatChange(value: number | null | undefined) {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function changeClass(value: number | null | undefined) {
  return value == null || value === 0
    ? ""
    : value > 0
      ? "positive"
      : "negative";
}

export function MarketList({
  tokens,
  loading,
  navigate,
  highlightedToken,
  previewStats = {},
  followSignal = {},
  view = "cards",
}: {
  tokens: Token[];
  loading: boolean;
  navigate: Navigate;
  highlightedToken?: string | null;
  previewStats?: MarketPreviewStatsByToken;
  /** Wallets the viewer last acted on each market, keyed by lowercase token address. */
  followSignal?: Record<string, number>;
  view?: "cards" | "rows";
}) {
  return (
    <div className="market-list" aria-live="polite">
      {loading && (
        <div
          className="market-list-skeleton"
          aria-busy="true"
          aria-label="Loading markets"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <div className="market-card-skeleton" key={index}>
              <span className="skeleton market-card-skeleton-image" />
              <span className="skeleton market-card-skeleton-line" />
              <span className="skeleton market-card-skeleton-line short" />
            </div>
          ))}
        </div>
      )}
      {!loading && !tokens.length && (
        <div className="empty-state" role="status">
          <span className="empty-orbit" aria-hidden="true" />
          <strong>No markets found.</strong>
          <p>Try another search or filter.</p>
        </div>
      )}
      {!loading && tokens.length > 0 && (
        <ul
          className={
            view === "rows"
              ? "market-card-grid market-card-grid-rows"
              : "market-card-grid"
          }
        >
          {tokens.map((token, index) => {
            const status = getMarketDisplayStatus(token);
            const stats = previewStats[token.address.toLowerCase()];
            const soldPercent = token.graduated
              ? 100
              : Math.min(100, Math.max(0, token.progress ?? 0));
            return (
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
                    <span className="visually-hidden">
                      View {token.name} market
                    </span>
                  </AppLink>
                  <div className="market-card-top">
                    <TokenAvatar token={token} index={index} />
                    <div className="market-card-identity-copy">
                      <strong className="market-card-name">{token.name}</strong>
                      <div className="market-card-byline">
                        <span className="market-card-symbol">
                          ${token.symbol}
                        </span>
                        <span className={`market-card-status ${status.kind}`}>
                          <span aria-hidden="true" />
                          {status.kind === "live"
                            ? "On the curve"
                            : status.label}
                        </span>
                        <span className="market-card-creator" title={token.creator}>
                          Creator <strong>{formatAddress(token.creator)}</strong>
                        </span>
                        <span className="market-card-created-date">
                          Created <time dateTime={token.createdAt}>{formatMarketDate(token.createdAt)}</time>
                        </span>
                      </div>
                    </div>
                  </div>
                  {highlightedToken?.toLowerCase() ===
                    token.address.toLowerCase() && (
                    <span className="market-new-tag">Just launched</span>
                  )}
                  <dl className="market-card-metrics">
                    <div>
                      <dt>1H</dt>
                      <dd className={changeClass(stats?.change1h)}>{formatChange(stats?.change1h)}</dd>
                    </div>
                    <div>
                      <dt>6H</dt>
                      <dd className={changeClass(stats?.change6h)}>{formatChange(stats?.change6h)}</dd>
                    </div>
                    <div>
                      <dt>24H</dt>
                      <dd className={changeClass(stats?.change24h)}>{formatChange(stats?.change24h)}</dd>
                    </div>
                    <div>
                      <dt>Volume 24h</dt>
                      <dd><UsdAmount weth={stats?.volume24h} compact /></dd>
                    </div>
                    <div>
                      <dt title="WETH deposited on the bonding curve; pool liquidity is unavailable">Liquidity</dt>
                      <dd><UsdAmount weth={token.curveLiquidityWeth} compact /></dd>
                    </div>
                    <div>
                      <dt>Market cap</dt>
                      <dd><UsdAmount weth={token.marketCap} compact /></dd>
                    </div>
                  </dl>
                  {followSignal[token.address.toLowerCase()] ? (
                    <p className="market-card-follows">
                      {followSignal[token.address.toLowerCase()]}{" "}
                      {followSignal[token.address.toLowerCase()] === 1
                        ? "follow"
                        : "follows"}{" "}
                      active here
                    </p>
                  ) : null}
                  <progress
                    className="market-card-progress-track"
                    value={soldPercent}
                    max={100}
                    aria-label={`${token.name} curve sold`}
                  />
                  <div className="market-card-footer">
                    <span className="market-card-fee">
                      {token.feeBps == null
                        ? "Fee unavailable"
                        : `Fee ${(token.feeBps / 100).toFixed(2)}%`}
                    </span>
                    <span className="market-card-curve">
                      {token.graduated
                        ? "Graduated · 100%"
                        : `${soldPercent.toFixed(1)}% sold`}
                    </span>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

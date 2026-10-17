import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatPercent } from "../lib/format.js";
import { getMarketDisplayStatus } from "../lib/marketState";
import type { Navigate, Token } from "../types";

export function MarketList({
  tokens,
  loading,
  navigate,
  highlightedToken,
}: {
  tokens: Token[];
  loading: boolean;
  navigate: Navigate;
  highlightedToken?: string | null;
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
                  <span className="market-card-identity">
                    <span className="market-card-identity-copy">
                      <strong className="market-card-name">{token.name}</strong>
                      <span className="market-card-symbol">${token.symbol}</span>
                    </span>
                    <span className="market-card-social-preview">
                      <a href="#" aria-label={`${token.name} website`}>
                        <svg className="market-card-social-globe" viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.4 2.5 3.75 5.6 3.75 9S14.4 18.5 12 21M12 3C9.6 5.5 8.25 8.6 8.25 12S9.6 18.5 12 21" />
                        </svg>
                      </a>
                      <a href="#" aria-label={`${token.name} Telegram`}>
                        <svg className="market-card-social-telegram" viewBox="170 280 590 500" aria-hidden="true">
                          <path d="M226.328 494.722c145.761-63.505 242.957-105.372 291.589-125.6 138.855-57.755 167.708-67.787 186.514-68.119 4.137-.072 13.385.953 19.375 5.814 5.059 4.104 6.451 9.648 7.117 13.54.666 3.891 1.495 12.756.836 19.683-7.525 79.062-40.084 270.925-56.648 359.475-7.009 37.469-20.81 50.032-34.17 51.262-29.036 2.672-51.085-19.189-79.208-37.624-44.006-28.847-68.867-46.804-111.583-74.953-49.366-32.531-17.364-50.411 10.769-79.631 7.363-7.647 135.296-124.012 137.772-134.568.31-1.32.597-6.242-2.326-8.841-2.924-2.598-7.239-1.71-10.353-1.003-4.413 1.002-74.714 47.468-210.902 139.399-19.955 13.703-38.029 20.379-54.223 20.029-17.853-.386-52.194-10.094-77.723-18.393-31.313-10.178-56.199-15.56-54.032-32.846 1.128-9.004 13.527-18.212 37.197-27.624Z" />
                        </svg>
                      </a>
                    </span>
                  </span>
                  {highlightedToken?.toLowerCase() === token.address.toLowerCase() && <span className="market-new-tag">Just launched</span>}
                  <span className="market-card-metrics">
                    <span><strong><UsdAmount weth={token.marketCap} compact /></strong></span>
                    <span><strong><UsdAmount weth={token.price} /></strong></span>
                  </span>
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

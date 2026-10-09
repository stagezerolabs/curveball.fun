import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatAddress, formatPercent } from "../lib/format.js";
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
              <AppLink
                route="market"
                params={{ address: token.address }}
                navigate={navigate}
                className={`market-card ${highlightedToken?.toLowerCase() === token.address.toLowerCase() ? "market-card-created" : ""}`}
              >
                <span className="market-card-art">
                  <TokenAvatar token={token} index={index} />
                  <span className={`market-card-status ${token.graduated ? "graduated" : "live"}`}>
                    {token.graduated ? "Graduated" : "Live"}
                  </span>
                </span>
                <span className="market-card-content">
                  <strong className="market-card-name">{token.name}</strong>
                  <span className="market-card-symbol">${token.symbol}</span>
                  <span className="market-card-address">{formatAddress(token.address)}</span>
                  {highlightedToken?.toLowerCase() === token.address.toLowerCase() && <span className="market-new-tag">Just launched</span>}
                  <span className="market-card-metrics">
                    <span><strong><UsdAmount weth={token.marketCap} compact /></strong><small>Market cap</small></span>
                    <span><strong><UsdAmount weth={token.price} /></strong><small>Price</small></span>
                  </span>
                  <span className="market-card-progress-label">
                    <span>{token.graduated ? "Graduated" : "Curve sold"}</span>
                    <strong>{token.graduated ? "100%" : formatPercent(token.progress)}</strong>
                  </span>
                  <span className="market-card-progress" aria-hidden="true"><span style={{ width: token.graduated ? "100%" : formatPercent(token.progress) }} /></span>
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      <div className="list-labels" aria-hidden="true">
        <span>Token</span>
        <span>Status</span>
        <span>Market</span>
      </div>
      {loading && (
        <div className="market-list-skeleton" aria-busy="true" aria-label="Loading markets">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="market-row" key={index}>
              <span className="skeleton skeleton-token" />
              <span className="skeleton skeleton-pill" />
              <span className="skeleton skeleton-value" />
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
      {!loading && tokens.map((token, index) => (
        <button
          type="button"
          className={`market-row ${highlightedToken?.toLowerCase() === token.address.toLowerCase() ? "market-row-created" : ""}`}
          key={token.address}
          onClick={() => navigate("market", { address: token.address })}
        >
          <span className="token-cell">
            <TokenAvatar token={token} index={index} />
            <span>
              <strong>{token.name}</strong>
              <small>${token.symbol}</small>
              <small className="market-token-address">{formatAddress(token.address)}</small>
              {highlightedToken?.toLowerCase() === token.address.toLowerCase() && <small className="market-new-tag">Just launched</small>}
            </span>
          </span>
          <span className={`status-pill ${token.graduated ? "graduated" : "live"}`}>
            <span>{token.graduated ? "Graduated" : "Live"}</span>
            {!token.graduated && <small>{formatPercent(token.progress)} sold</small>}
          </span>
          {token.graduated ? (
            <span className="market-cell">
              <strong>Graduated</strong>
            </span>
          ) : (
            <span className="market-cell">
              <strong><UsdAmount weth={token.price} /></strong>
              <small><UsdAmount weth={token.marketCap} suffix=" cap" /></small>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

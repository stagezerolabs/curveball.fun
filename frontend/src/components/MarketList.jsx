import { AppLink } from "./Navigation.jsx";
import { ArrowIcon } from "./ArrowIcon.jsx";

export function MarketList({ tokens, loading, navigate }) {
  return (
    <div className="market-list" aria-live="polite">
      <div className="list-labels" aria-hidden="true">
        <span>Token</span>
        <span>Status</span>
        <span>Market</span>
      </div>
      {loading && <div className="empty-state">Loading the latest curves…</div>}
      {!loading && !tokens.length && (
        <div className="empty-state">
          <span className="empty-orbit" aria-hidden="true" />
          <strong>The curve is wide open.</strong>
          <p>Be the first token to bend it.</p>
          <AppLink route="launch" navigate={navigate}>
            Launch the first market <ArrowIcon />
          </AppLink>
        </div>
      )}
      {tokens.map((token, index) => (
        <button
          className="market-row"
          key={token.address}
          onClick={() => navigate("market", { address: token.address })}
        >
          <span className="token-cell">
            <span className={`token-avatar hue-${index % 4}`}>
              {(token.symbol || "?").slice(0, 1)}
            </span>
            <span>
              <strong>{token.name}</strong>
              <small>${token.symbol}</small>
            </span>
          </span>
          <span
            className={`status-pill ${token.graduated ? "graduated" : "live"}`}
          >
            <i /> {token.graduated ? "Graduated" : "Curve live"}
          </span>
          <span className="address-cell">
            {token.address.slice(0, 6)}…{token.address.slice(-4)} <ArrowIcon />
          </span>
        </button>
      ))}
    </div>
  );
}

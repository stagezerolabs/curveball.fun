import { AppLink } from "./Navigation.jsx";
import { ArrowIcon } from "./ArrowIcon.jsx";
import { TokenAvatar } from "./TokenAvatar.jsx";
import { formatEthAmount, formatPercent } from "../lib/format.js";

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
            <TokenAvatar token={token} index={index} />
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
          {token.graduated ? (
            <span className="market-cell">
              <strong>Graduated</strong>
              <ArrowIcon />
            </span>
          ) : (
            <span className="market-cell">
              <strong>{formatEthAmount(token.price)} ETH</strong>
              <small>{formatEthAmount(token.marketCap)} ETH cap</small>
            </span>
          )}
          {!token.graduated && (
            <span className="row-progress" aria-hidden="true">
              <span
                className="row-progress-fill"
                style={{ width: formatPercent(token.progress) }}
              />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

import { AppLink } from "./Navigation";
import { ArrowIcon } from "./ArrowIcon";
import { TokenAvatar } from "./TokenAvatar";
import { formatAddress, formatEthAmount, formatPercent } from "../lib/format.js";
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
              <strong>{token.price == null ? "—" : `${formatEthAmount(token.price)} WETH`}</strong>
              <small>{token.marketCap == null ? "—" : `${formatEthAmount(token.marketCap)} WETH cap`}</small>
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

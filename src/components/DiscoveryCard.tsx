import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatAddress, formatPercent } from "../lib/format.js";
import type { Navigate, Token } from "../types";

export function DiscoveryCard({
  token,
  index,
  navigate,
}: {
  token: Token;
  index: number;
  navigate: Navigate;
}) {
  const progress = token.graduated ? 100 : Math.min(100, Math.max(0, token.progress ?? 0));

  return (
    <li>
      <AppLink
        className="discovery-card"
        route="market"
        params={{ address: token.address }}
        navigate={navigate}
      >
        <span className="discovery-card-art">
          <TokenAvatar token={token} index={index} />
          <span className={`discovery-card-status ${token.graduated ? "graduated" : ""}`}>
            {token.graduated ? "Graduated" : "Curve live"}
          </span>
        </span>
        <span className="discovery-card-info">
          <strong className="discovery-card-name">{token.name}</strong>
          <span className="discovery-card-symbol">${token.symbol}</span>
          <code>{formatAddress(token.address)}</code>
          <span className="discovery-card-rule" />
          <span className="discovery-card-cap">
            <strong><UsdAmount weth={token.marketCap} compact /></strong>
            <small>market cap</small>
          </span>
          <span className="discovery-card-progress" aria-label={`${formatPercent(progress)} of curve sold`}>
            <span style={{ width: `${progress}%` }} />
          </span>
          <span className="discovery-card-progress-label">
            {token.graduated ? "Graduated" : `${formatPercent(progress)} sold`}
          </span>
        </span>
      </AppLink>
    </li>
  );
}

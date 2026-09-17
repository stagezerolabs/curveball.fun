import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import {
  formatAddress,
  formatEthAmount,
  formatPercent,
  formatRelativeTime,
} from "../lib/format.js";
import type { Navigate, Token } from "../types";

export function TokenCard({
  token,
  index,
  navigate,
}: {
  token: Token;
  index: number;
  navigate: Navigate;
}) {
  return (
    <li>
      <AppLink
        className="launch-card"
        route="market"
        params={{ address: token.address }}
        navigate={navigate}
      >
        <span className="launch-card-media">
          <TokenAvatar
            token={token}
            index={index}
            className="launch-card-logo"
          />
          <span className="launch-card-badges">
            {token.graduated ? (
              <span className="launch-card-badge graduated">Graduated</span>
            ) : (
              <span className="launch-card-badge live">
                {formatPercent(token.progress)}
              </span>
            )}
          </span>
        </span>
        <span className="launch-card-body">
          <span className="launch-card-name-row">
            <strong>{token.name}</strong>
            <small>${token.symbol}</small>
          </span>
          <span className="launch-card-mcap">
            <span className="launch-card-mcap-value">
              {formatEthAmount(token.marketCap)}
            </span>
            <span className="launch-card-mcap-label">ETH cap</span>
            {!token.graduated && (
              <span className="launch-card-price">
                / {formatEthAmount(token.price)} ETH
              </span>
            )}
          </span>
          <span className="launch-card-meta">
            <span>{formatAddress(token.creator)}</span>
            <time dateTime={token.createdAt}>
              {formatRelativeTime(token.createdAt)}
            </time>
          </span>
        </span>
        {!token.graduated && (
          <span className="launch-card-progress" aria-hidden="true">
            <span style={{ width: formatPercent(token.progress) }} />
          </span>
        )}
      </AppLink>
    </li>
  );
}

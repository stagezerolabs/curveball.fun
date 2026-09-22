import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import {
  changeTone,
  formatAddress,
  formatChange,
  formatCompact,
  formatCount,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  formatUsdCompact,
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
        className="tcard"
        route="market"
        params={{ address: token.address }}
        navigate={navigate}
      >
        <span className="tcard-media">
          <TokenAvatar token={token} index={index} className="tcard-image" />
          <span className={`tcard-change change ${changeTone(token.change24h)}`}>
            {formatChange(token.change24h)} <small>24h</small>
          </span>
          <span className="tcard-milestone">
            {token.graduated
              ? "Graduated"
              : `${formatPercent(token.progress)} of graduation`}
          </span>
          {!token.graduated && (
            <span className="tcard-progress" aria-hidden="true">
              <span style={{ width: formatPercent(token.progress) }} />
            </span>
          )}
        </span>

        <span className="tcard-body">
          <span className="tcard-title">
            <strong>${token.symbol}</strong>
            <small>{token.name}</small>
            {token.quoteSymbol && (
              <span className="tcard-paired">
                Paired with<i>{token.quoteSymbol}</i>
              </span>
            )}
          </span>

          <span className="tcard-meta">
            {formatAddress(token.address)} · {formatRelativeTime(token.createdAt)}
          </span>

          <span className="tcard-figures">
            <span>
              <small>Market cap</small>
              <strong>{formatUsdCompact(token.marketCapUsd)}</strong>
            </span>
            <span className="tcard-figure-end">
              <small>Price</small>
              <strong>{formatUsd(token.priceUsd)}</strong>
            </span>
          </span>

          <span className="tcard-footer">
            <span className={token.graduated ? "graduated" : "live"}>
              <i aria-hidden="true" />
              {token.graduated ? "Graduated" : "Curve live"}
            </span>
            <span>{formatCount(token.holders)} holders</span>
            <span>Vol {formatCompact(token.volume24h)} ETH</span>
          </span>
        </span>
      </AppLink>
    </li>
  );
}

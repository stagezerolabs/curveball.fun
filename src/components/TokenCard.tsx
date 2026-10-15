import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import {
  formatAddress,
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
        className="tcard"
        route="market"
        params={{ address: token.address }}
        navigate={navigate}
      >
        <span className="tcard-head">
          <TokenAvatar token={token} index={index} className="tcard-image" />
          <span className="tcard-identity">
            <strong>{token.name}</strong>
            <small>${token.symbol}</small>
          </span>
          {token.quoteSymbol && (
            <span className="tcard-paired">{token.quoteSymbol}</span>
          )}
          <span className={`tcard-status ${token.graduated ? "graduated" : "live"}`}>
            {token.graduated ? "Graduated" : "Live"}
          </span>
        </span>

        <span className="tcard-body">
          <span className="tcard-figures">
            <span>
              <small>Market cap</small>
              <strong><UsdAmount weth={token.marketCap} /></strong>
            </span>
            <span className="tcard-figure-end">
              <small>{token.graduated ? "Status" : "Graduation"}</small>
              <strong>{token.graduated ? "Complete" : formatPercent(token.progress)}</strong>
            </span>
          </span>

          {!token.graduated && (
            <span className="tcard-progress" aria-hidden="true">
              <span style={{ width: formatPercent(token.progress) }} />
            </span>
          )}

          <span className="tcard-footer">
            <span>{formatAddress(token.address)}</span>
            <span>{formatRelativeTime(token.createdAt)}</span>
          </span>
        </span>
      </AppLink>
    </li>
  );
}

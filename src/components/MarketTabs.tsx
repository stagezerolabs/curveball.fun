import { formatAddress, formatRelativeTime } from "../lib/format.js";
import { activeExplorerUrl } from "../lib/web3";
import type { Token } from "../types";

const EXPLORER_ADDRESS = `${activeExplorerUrl}/address/`;

export function MarketTabs({ token }: { token: Token }) {
  return (
    <section className="detail-tabs" aria-labelledby="market-details-title">
      <div className="tab-strip">
        <strong id="market-details-title">On-chain details</strong>
      </div>
      <div className="tab-panel about-panel">
        <dl className="about-facts">
          <div><dt>Token</dt><dd><a href={`${EXPLORER_ADDRESS}${token.address}`} target="_blank" rel="noreferrer">{formatAddress(token.address)}</a></dd></div>
          {token.curve && <div><dt>Curve</dt><dd><a href={`${EXPLORER_ADDRESS}${token.curve}`} target="_blank" rel="noreferrer">{formatAddress(token.curve)}</a></dd></div>}
          <div><dt>Creator</dt><dd><a href={`${EXPLORER_ADDRESS}${token.creator}`} target="_blank" rel="noreferrer">{formatAddress(token.creator)}</a></dd></div>
          {token.pool && <div><dt>Pool</dt><dd><a href={`${EXPLORER_ADDRESS}${token.pool}`} target="_blank" rel="noreferrer">{formatAddress(token.pool)}</a></dd></div>}
          <div><dt>Launched</dt><dd>{formatRelativeTime(token.createdAt)}</dd></div>
        </dl>
      </div>
    </section>
  );
}

import { formatEther } from "viem";
import { AppLink } from "../components/Navigation";
import { formatEthAmount, formatRelativeTime } from "../lib/format.js";
import { activeExplorerUrl } from "../lib/web3";
import type { Navigate } from "../types";
import type { PulseMoment } from "./types";

function quote(wei: string) {
  return formatEthAmount(Number(formatEther(BigInt(wei))));
}

function reasonText(moment: PulseMoment) {
  if (moment.reason === "following") {
    const count = moment.followedTraderCount;
    return `${count} followed trader${count === 1 ? "" : "s"} traded this market in the window.`;
  }
  if (moment.reason === "net_buying") return "Buy value exceeded sell value in this window.";
  if (moment.reason === "net_selling") return "Sell value exceeded buy value in this window.";
  return "A cluster of confirmed trades in this market.";
}

export function PulseMomentCard({ moment, navigate, newSinceVisit, preview = false }: {
  moment: PulseMoment;
  navigate: Navigate;
  newSinceVisit: boolean;
  preview?: boolean;
}) {
  const net = BigInt(moment.netQuoteWei);
  const direction = net > 0n ? "Net buying" : net < 0n ? "Net selling" : "Balanced";
  const directionClass = net > 0n ? "positive" : net < 0n ? "negative" : "";

  return <article className="pulse-moment">
    <div className="pulse-moment-topline">
      <span className={`pulse-moment-direction ${directionClass}`}>{direction}</span>
      {preview ? <span className="pulse-example-tag">Example</span> : null}
      {newSinceVisit ? <span className="pulse-new-marker">New since last visit</span> : null}
      <time dateTime={moment.latestAt} title={new Date(moment.latestAt).toLocaleString()}>{formatRelativeTime(moment.latestAt)}</time>
    </div>
    <div className="pulse-moment-main">
      <div className="pulse-moment-token">
        <span className="pulse-token-symbol" aria-hidden="true">{moment.tokenSymbol.slice(0, 1).toUpperCase() || "?"}</span>
        <div>
          <h3>{preview ? moment.tokenName : <AppLink route="market" params={{ address: moment.tokenAddress }} navigate={navigate}>{moment.tokenName}</AppLink>}</h3>
          <span>${moment.tokenSymbol}</span>
        </div>
      </div>
      <div className="pulse-moment-net">
        <strong className={directionClass}>{net > 0n ? "+" : ""}{quote(moment.netQuoteWei)} WETH</strong>
        <span>buy value less sell value</span>
      </div>
    </div>
    <p className="pulse-moment-reason"><span>Why shown</span>{reasonText(moment)}</p>
    <dl className="pulse-moment-facts">
      <div><dt>Trades</dt><dd>{moment.tradeCount.toLocaleString()} <small>({moment.buyCount} buy / {moment.sellCount} sell)</small></dd></div>
      <div><dt>Buy / sell</dt><dd>{quote(moment.buyQuoteWei)} / {quote(moment.sellQuoteWei)} <small>WETH</small></dd></div>
      <div><dt>Wallets</dt><dd>{moment.distinctWalletCount.toLocaleString()}</dd></div>
    </dl>
    <footer className="pulse-moment-footer">
      <span>Observed {formatRelativeTime(moment.firstAt)}–{formatRelativeTime(moment.latestAt)}</span>
      {preview ? <span>Illustrative data · no onchain transaction</span> : <div>
        <a href={`${activeExplorerUrl}/tx/${moment.sampleTransactionHash}`} target="_blank" rel="noreferrer">Sample transaction <span aria-hidden="true">↗</span></a>
        <AppLink route="market" params={{ address: moment.tokenAddress }} navigate={navigate}>View market <span aria-hidden="true">→</span></AppLink>
      </div>}
    </footer>
  </article>;
}

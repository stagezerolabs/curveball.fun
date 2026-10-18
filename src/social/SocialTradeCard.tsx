import { formatEther } from "viem";
import { AppLink } from "../components/Navigation";
import { TokenAvatar } from "../components/TokenAvatar";
import { formatEthAmount, formatRelativeTime } from "../lib/format.js";
import { activeExplorerUrl } from "../lib/web3";
import type { Navigate, Token } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import type { SocialTrade } from "./types";

export function SocialTradeCard({ trade, navigate }: {
  trade: SocialTrade;
  navigate: Navigate;
}) {
  const quote = Number(formatEther(BigInt(trade.quoteAmountWei)));
  const tokenAmount = Number(formatEther(BigInt(trade.tokenAmountWei)));
  const activityToken: Token = {
    address: trade.tokenAddress,
    name: trade.tokenName,
    symbol: trade.tokenSymbol,
    creator: trade.traderAddress,
    graduated: false,
    createdAt: trade.blockTimestamp,
  };

  return (
    <article className="social-trade-card">
      <header>
        <TraderIdentity address={trade.traderAddress} displayName={trade.displayName} navigate={navigate} showAddress={false} />
        <time dateTime={trade.blockTimestamp} title={new Date(trade.blockTimestamp).toLocaleString()}>{formatRelativeTime(trade.blockTimestamp)}</time>
      </header>
      <div className="social-trade-body">
        <AppLink className="social-token-link" route="market" params={{ address: trade.tokenAddress }} navigate={navigate}>
          <TokenAvatar token={activityToken} className="social-token-avatar" />
          <span><strong>{trade.tokenName}</strong><small>${trade.tokenSymbol}</small></span>
        </AppLink>
        <div className="social-trade-statement">
          <span className={`social-side ${trade.isBuy ? "buy" : "sell"}`}>{trade.isBuy ? "Bought" : "Sold"}</span>
          <strong>{formatEthAmount(tokenAmount)} {trade.tokenSymbol}</strong>
          <span>for {formatEthAmount(quote)} WETH</span>
        </div>
      </div>
      <footer>
        <div className="social-trade-actions">
          <a href={`${activeExplorerUrl}/tx/${trade.transactionHash}`} target="_blank" rel="noreferrer">View transaction <span aria-hidden="true">↗</span></a>
          <AppLink route="market" params={{ address: trade.tokenAddress }} navigate={navigate} aria-label={`Copy ${trade.tokenName} trade`}>Copy</AppLink>
        </div>
      </footer>
    </article>
  );
}

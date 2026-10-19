import { formatEther } from "viem";
import { AppLink } from "../components/Navigation";
import { TokenAvatar } from "../components/TokenAvatar";
import { UsdAmount } from "../components/UsdAmount";
import { formatAddress, formatEthAmount } from "../lib/format.js";
import { TraderAvatar } from "./TraderAvatar";
import type { Navigate, Token } from "../types";
import type { FollowingBuy } from "./types";

const STACK_LIMIT = 3;

function buyerName(buyer: FollowingBuy["buyers"][number]) {
  return buyer.displayName ?? formatAddress(buyer.address);
}

function buyerSummary(buyers: FollowingBuy["buyers"]) {
  const names = buyers.slice(0, 2).map(buyerName);
  const rest = buyers.length - names.length;
  return rest > 0 ? `${names.join(", ")} +${rest}` : names.join(" and ");
}

/** A market wallets you follow have bought into: the token, who bought, and the WETH they put in. */
export function PulseFollowingCard({ buy, token, navigate }: {
  buy: FollowingBuy;
  token: Token | null;
  navigate: Navigate;
}) {
  return <article className="pulse-now-card pulse-following-card">
    <AppLink route="market" params={{ address: buy.tokenAddress }} navigate={navigate} className="pulse-now-link" aria-label={`View ${buy.tokenName} market`}>
      <span className="visually-hidden">View {buy.tokenName} market</span>
    </AppLink>
    <div className="pulse-now-token">
      {token
        ? <TokenAvatar token={token} className="pulse-now-image" />
        : <span className="pulse-token-symbol pulse-now-image" aria-hidden="true">{buy.tokenSymbol.slice(0, 1).toUpperCase() || "?"}</span>}
      <div>
        <h3>{buy.tokenName}</h3>
        <p>
          <span>${buy.tokenSymbol}</span>
          {token?.marketCap != null ? <span>MC <UsdAmount weth={token.marketCap} compact /></span> : null}
        </p>
      </div>
    </div>
    <div className="pulse-following-buyers">
      <span className="pulse-following-stack" aria-hidden="true">
        {buy.buyers.slice(0, STACK_LIMIT).map((buyer) => <TraderAvatar key={buyer.address} address={buyer.address} name={buyerName(buyer)} />)}
      </span>
      <span>
        <strong>{buyerSummary(buy.buyers)}</strong>
        <small>{buy.buyers.length === 1 ? "1 follow bought" : `${buy.buyers.length} follows bought`}</small>
      </span>
    </div>
    <div className="pulse-now-net">
      <strong>{formatEthAmount(Number(formatEther(BigInt(buy.boughtQuoteWei))))} <small>WETH</small></strong>
      <span>buy volume in window</span>
    </div>
  </article>;
}

import { formatEther } from "viem";
import { AppLink } from "../components/Navigation";
import { TokenAvatar } from "../components/TokenAvatar";
import { UsdAmount } from "../components/UsdAmount";
import { formatEthAmount } from "../lib/format.js";
import type { Navigate, Token } from "../types";
import type { PulseMoment } from "./types";

function quote(wei: bigint) {
  return formatEthAmount(Number(formatEther(wei)));
}

/** One market being bought into: who it is, how the buy/sell value splits, and what flowed in. */
export function PulseNowCard({
  moment,
  token,
  navigate,
}: {
  moment: PulseMoment;
  token: Token | null;
  navigate: Navigate;
}) {
  const buy = BigInt(moment.buyQuoteWei);
  const sell = BigInt(moment.sellQuoteWei);
  const total = buy + sell;
  const buyShare = total > 0n ? Number((buy * 1_000n) / total) / 10 : 100;
  const progress =
    token && !token.graduated && token.progress != null
      ? Math.min(100, Math.max(0, token.progress))
      : null;

  return (
    <article className="pulse-now-card">
      <AppLink
        route="market"
        params={{ address: moment.tokenAddress }}
        navigate={navigate}
        className="pulse-now-link"
        aria-label={`View ${moment.tokenName} market`}
      >
        <span className="visually-hidden">View {moment.tokenName} market</span>
      </AppLink>
      <div className="pulse-now-token">
        {token ? (
          <TokenAvatar token={token} className="pulse-now-image" />
        ) : (
          <span
            className="pulse-token-symbol pulse-now-image"
            aria-hidden="true"
          >
            {moment.tokenSymbol.slice(0, 1).toUpperCase() || "?"}
          </span>
        )}
        <div>
          <h3>{moment.tokenName}</h3>
          <p>
            <span>${moment.tokenSymbol}</span>
            {token?.marketCap != null ? (
              <span>
                MC <UsdAmount weth={token.marketCap} compact />
              </span>
            ) : null}
            {progress != null ? (
              <span>{progress.toFixed(0)}% to graduation</span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="pulse-now-flow">
        <div
          className="pulse-now-split"
          role="img"
          aria-label={`${buyShare.toFixed(0)}% of value bought, ${(100 - buyShare).toFixed(0)}% sold`}
        >
          <span className="buy" style={{ width: `${buyShare}%` }} />
          <span className="sell" />
        </div>
        <p>
          <span className="buy">{quote(buy)} bought</span>
          <span className="sell">{quote(sell)} sold</span>
        </p>
      </div>
      <div className="pulse-now-net">
        <strong>
          +{quote(buy - sell)} <small>WETH</small>
        </strong>
        <span>net inflow</span>
      </div>
    </article>
  );
}

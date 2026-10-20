import { formatEther } from "viem";
import { AppLink } from "../components/Navigation";
import { TokenAvatar } from "../components/TokenAvatar";
import { UsdAmount } from "../components/UsdAmount";
import { formatEthAmount, formatRelativeTime } from "../lib/format.js";
import { TraderAvatar } from "./TraderAvatar";
import { TraderName } from "./TraderIdentity";
import type { Navigate, Token } from "../types";
import type { FollowingActivity, FollowingActor } from "./types";

const STACK_LIMIT = 3;
const NAME_LIMIT = 2;

const ACTION_WORD: Record<FollowingActor["action"], string> = {
  launch: "created",
  buy: "bought",
  sell: "sold",
};

function weth(wei: string) {
  return Number(formatEther(BigInt(wei || "0")));
}

/** A market wallets you follow touched: what they did, who did it, and the WETH they moved. */
export function PulseFollowingCard({ activity, token, scope, navigate }: {
  activity: FollowingActivity;
  token: Token | null;
  scope: "following" | "unlinked";
  navigate: Navigate;
}) {
  const actors = activity.actors;
  const wallets = new Set(actors.map((actor) => actor.address.toLowerCase())).size;
  const buys = actors.filter((actor) => actor.action === "buy");
  const sells = actors.filter((actor) => actor.action === "sell");
  const launched = actors.some((actor) => actor.action === "launch");
  const netWei = BigInt(activity.boughtQuoteWei) - BigInt(activity.soldQuoteWei);
  const noun = scope === "following" ? (wallets === 1 ? "follow" : "follows") : wallets === 1 ? "wallet" : "wallets";
  const summary = launched && !buys.length && !sells.length
    ? "just created"
    : `${formatEthAmount(weth(activity.boughtQuoteWei))} WETH in · ${wallets} ${noun} active`;

  return <article className="pulse-now-card pulse-following-card">
    <AppLink route="market" params={{ address: activity.tokenAddress }} navigate={navigate} className="pulse-now-link" aria-label={`View ${activity.tokenName} market`}>
      <span className="visually-hidden">View {activity.tokenName} market</span>
    </AppLink>
    <div className="pulse-now-token">
      {token
        ? <TokenAvatar token={token} className="pulse-now-image" />
        : <span className="pulse-token-symbol pulse-now-image" aria-hidden="true">{activity.tokenSymbol.slice(0, 1).toUpperCase() || "?"}</span>}
      <div>
        <h3>{activity.tokenName}</h3>
        <p>
          <span>${activity.tokenSymbol}</span>
          {token?.marketCap != null ? <span>MC <UsdAmount weth={token.marketCap} compact /></span> : null}
        </p>
      </div>
    </div>
    <div className="pulse-following-buyers">
      <span className="pulse-following-stack" aria-hidden="true">
        {actors.slice(0, STACK_LIMIT).map((actor) => <TraderAvatar key={`${actor.address}${actor.action}`} address={actor.address} name={actor.address} />)}
      </span>
      <span>
        <strong>
          {actors.slice(0, NAME_LIMIT).map((actor, index) => <span key={`${actor.address}${actor.action}`} className="pulse-following-actor">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <TraderName address={actor.address} navigate={navigate} />
            <em>{ACTION_WORD[actor.action]}</em>
          </span>)}
          {actors.length > NAME_LIMIT ? <span>+{actors.length - NAME_LIMIT}</span> : null}
        </strong>
        <small>{summary} · {formatRelativeTime(activity.latestAt)}</small>
      </span>
    </div>
    <div className="pulse-now-net">
      <strong>{formatEthAmount(Math.abs(Number(formatEther(netWei))))} <small>WETH</small></strong>
      <span>{netWei < 0n ? "net sold" : "net bought"} by {scope === "following" ? "follows" : "wallets"}</span>
    </div>
  </article>;
}

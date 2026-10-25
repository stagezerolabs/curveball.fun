import type { Address } from "viem";
import type { MarketTradeSample } from "../lib/marketPreviewStats";
import type { Token } from "../types";
import type { FollowingActivity, FollowingActor } from "./types";

export const FOLLOWING_ACTIVITY_LIMIT = 12;

type MarketEvents = {
  token: Pick<Token, "address" | "name" | "symbol">;
  actors: Map<string, FollowingActor>;
  bought: bigint;
  sold: bigint;
  latest: number;
};

/**
 * Groups launches, buys and sells by market, most recent activity first. Mirrors the backend's
 * `followingActivitySql`; `traders` narrows to followed wallets. Null means there is no follow graph
 * at all (the no-backend fallback), where only buys from every wallet are worth showing.
 */
export function buildFollowingActivity(
  samples: readonly MarketTradeSample[],
  tokens: readonly Pick<
    Token,
    "address" | "name" | "symbol" | "creator" | "createdAt"
  >[],
  traders: ReadonlySet<string> | null = null,
): FollowingActivity[] {
  const markets = new Map<string, MarketEvents>();

  const record = (
    token: Pick<Token, "address" | "name" | "symbol" | "creator">,
    actor: FollowingActor,
    at: number,
  ) => {
    const key = token.address.toLowerCase();
    const market = markets.get(key) ?? {
      token: { address: token.address, name: token.name, symbol: token.symbol },
      actors: new Map(),
      bought: 0n,
      sold: 0n,
      latest: 0,
    };
    const actorKey = `${actor.address.toLowerCase()}:${actor.action}`;
    const previous = market.actors.get(actorKey);
    if (previous) {
      previous.amountQuoteWei = (
        BigInt(previous.amountQuoteWei) + BigInt(actor.amountQuoteWei)
      ).toString();
    } else {
      market.actors.set(actorKey, { ...actor });
    }
    if (actor.action === "buy") market.bought += BigInt(actor.amountQuoteWei);
    if (actor.action === "sell") market.sold += BigInt(actor.amountQuoteWei);
    market.latest = Math.max(market.latest, at);
    markets.set(key, market);
  };

  if (traders) {
    for (const token of tokens) {
      if (!traders.has(token.creator.toLowerCase())) continue;
      record(
        token,
        { address: token.creator, action: "launch", amountQuoteWei: "0" },
        Math.floor(Date.parse(token.createdAt) / 1000) || 0,
      );
    }
  }

  const known = new Map(
    tokens.map((token) => [token.address.toLowerCase(), token]),
  );
  for (const sample of samples) {
    if (!sample.trader || sample.quoteWei == null) continue;
    const isBuy = sample.isBuy === true;
    if (!traders ? !isBuy : !traders.has(sample.trader.toLowerCase())) continue;
    const token = known.get(sample.token.toLowerCase());
    if (!token) continue;
    record(
      token,
      {
        address: sample.trader,
        action: isBuy ? "buy" : "sell",
        amountQuoteWei: sample.quoteWei.toString(),
      },
      sample.timestamp,
    );
  }

  return [...markets.values()]
    .map((market) => {
      const actors = [...market.actors.values()].sort((a, b) => {
        const left = BigInt(a.amountQuoteWei);
        const right = BigInt(b.amountQuoteWei);
        if (left === right)
          return a.address.toLowerCase().localeCompare(b.address.toLowerCase());
        return left > right ? -1 : 1;
      });
      return {
        market,
        actors,
        bought: market.bought,
        sold: market.sold,
        latest: market.latest,
      };
    })
    .sort((a, b) => b.latest - a.latest || b.actors.length - a.actors.length)
    .slice(0, FOLLOWING_ACTIVITY_LIMIT)
    .map(({ market, actors, bought, sold }) => ({
      tokenAddress: market.token.address as Address,
      tokenName: market.token.name,
      tokenSymbol: market.token.symbol,
      actors,
      boughtQuoteWei: bought.toString(),
      soldQuoteWei: sold.toString(),
      latestAt: new Date(market.latest * 1000).toISOString(),
    }));
}

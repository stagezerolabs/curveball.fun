import type { Address } from "viem";
import type { MarketTradeSample } from "../lib/marketPreviewStats";
import type { Token } from "../types";
import type { FollowingBuy } from "./types";

export const FOLLOWING_BUYS_LIMIT = 12;

/**
 * Groups buys by market with each buyer's WETH spend, most buyers first. Mirrors the backend's
 * `followingBuysSql`; `traders` narrows to followed wallets, null counts every wallet.
 */
export function buildFollowingBuys(
  samples: readonly MarketTradeSample[],
  tokens: readonly Pick<Token, "address" | "name" | "symbol">[],
  traders: ReadonlySet<string> | null = null,
): FollowingBuy[] {
  const known = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  const markets = new Map<string, Map<string, { address: Address; bought: bigint }>>();
  for (const sample of samples) {
    if (sample.isBuy !== true || sample.quoteWei == null || !sample.trader) continue;
    const key = sample.token.toLowerCase();
    const trader = sample.trader.toLowerCase();
    if (!known.has(key) || (traders && !traders.has(trader))) continue;
    const buyers = markets.get(key) ?? new Map();
    const buyer = buyers.get(trader) ?? { address: sample.trader, bought: 0n };
    buyer.bought += sample.quoteWei;
    buyers.set(trader, buyer);
    markets.set(key, buyers);
  }
  return [...markets.entries()]
    .map(([key, buyers]) => {
      const ranked = [...buyers.values()].sort((a, b) => (a.bought === b.bought ? 0 : b.bought > a.bought ? 1 : -1));
      const total = ranked.reduce((sum, buyer) => sum + buyer.bought, 0n);
      const token = known.get(key)!;
      return { token, ranked, total };
    })
    .sort((a, b) => b.ranked.length - a.ranked.length || (a.total === b.total ? 0 : b.total > a.total ? 1 : -1))
    .slice(0, FOLLOWING_BUYS_LIMIT)
    .map(({ token, ranked, total }) => ({
      tokenAddress: token.address as Address,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      buyers: ranked.map((buyer) => ({ address: buyer.address, displayName: null })),
      boughtQuoteWei: total.toString(),
    }));
}

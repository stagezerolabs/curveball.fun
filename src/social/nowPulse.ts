import type { Address, Hash } from "viem";
import type { MarketTradeSample } from "../lib/marketPreviewStats";
import type { Token } from "../types";
import type { PulseMoment, PulsePeriod } from "./types";

export const NOW_PULSE_LIMIT = 12;

export function pulsePeriodSeconds(period: PulsePeriod) {
  return period === "1h" ? 3_600 : 86_400;
}

type MarketTally = {
  token: Pick<Token, "address" | "name" | "symbol">;
  first: number;
  latest: number;
  buyCount: number;
  sellCount: number;
  buyWei: bigint;
  sellWei: bigint;
  wallets: Set<string>;
  latestBuy: { timestamp: number; hash: Hash } | null;
};

/**
 * Groups curve trades by market over the window and keeps only markets where buy value beat
 * sell value, ranked by net inflow. Mirrors the backend's `nowPulseSql`.
 */
export function buildNowMoments(
  samples: readonly MarketTradeSample[],
  tokens: readonly Pick<Token, "address" | "name" | "symbol">[],
  period: PulsePeriod,
  now = Date.now() / 1_000,
): PulseMoment[] {
  const known = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  const cutoff = now - pulsePeriodSeconds(period);
  const tallies = new Map<string, MarketTally>();

  for (const sample of samples) {
    if (sample.timestamp < cutoff || sample.timestamp > now) continue;
    if (typeof sample.isBuy !== "boolean" || sample.quoteWei == null || !sample.trader) continue;
    const key = sample.token.toLowerCase();
    const token = known.get(key);
    if (!token) continue;
    let tally = tallies.get(key);
    if (!tally) {
      tally = { token, first: sample.timestamp, latest: sample.timestamp, buyCount: 0, sellCount: 0, buyWei: 0n, sellWei: 0n, wallets: new Set(), latestBuy: null };
      tallies.set(key, tally);
    }
    tally.first = Math.min(tally.first, sample.timestamp);
    tally.latest = Math.max(tally.latest, sample.timestamp);
    tally.wallets.add(sample.trader.toLowerCase());
    if (sample.isBuy) {
      tally.buyCount += 1;
      tally.buyWei += sample.quoteWei;
      if (sample.transactionHash && (!tally.latestBuy || sample.timestamp >= tally.latestBuy.timestamp)) {
        tally.latestBuy = { timestamp: sample.timestamp, hash: sample.transactionHash };
      }
    } else {
      tally.sellCount += 1;
      tally.sellWei += sample.quoteWei;
    }
  }

  return [...tallies.values()]
    .filter((tally) => tally.buyWei > tally.sellWei)
    .sort((a, b) => {
      const netA = a.buyWei - a.sellWei;
      const netB = b.buyWei - b.sellWei;
      return netA === netB ? b.latest - a.latest : netB > netA ? 1 : -1;
    })
    .slice(0, NOW_PULSE_LIMIT)
    .map((tally) => ({
      tokenAddress: tally.token.address as Address,
      tokenName: tally.token.name,
      tokenSymbol: tally.token.symbol,
      firstAt: new Date(tally.first * 1_000).toISOString(),
      latestAt: new Date(tally.latest * 1_000).toISOString(),
      tradeCount: tally.buyCount + tally.sellCount,
      buyCount: tally.buyCount,
      sellCount: tally.sellCount,
      distinctWalletCount: tally.wallets.size,
      buyQuoteWei: tally.buyWei.toString(),
      sellQuoteWei: tally.sellWei.toString(),
      netQuoteWei: (tally.buyWei - tally.sellWei).toString(),
      followedTraderCount: 0,
      reason: "net_buying",
      sampleTransactionHash: tally.latestBuy?.hash ?? `0x${"0".repeat(64)}`,
    }));
}

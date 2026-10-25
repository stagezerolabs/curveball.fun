import { formatEther } from "viem";
import type { TradeActivity } from "./marketChart";

export type MarketDepositPoint = {
  time: number;
  value: number;
};

export type MarketDepositRange = "day" | "week" | "month" | "all";

const RANGE_SECONDS: Record<Exclude<MarketDepositRange, "all">, number> = {
  day: 86_400,
  week: 7 * 86_400,
  month: 30 * 86_400,
};

/** Convert post-trade virtual reserves into the real quote deposited in the curve. */
export function buildMarketDepositPoints(
  trades: readonly TradeActivity[],
  initialVirtualQuote: string | null | undefined,
): MarketDepositPoint[] {
  if (!initialVirtualQuote || !/^\d+$/.test(initialVirtualQuote)) return [];
  const initial = BigInt(initialVirtualQuote);

  return trades
    .flatMap((trade): MarketDepositPoint[] => {
      if (trade.venue !== "curve" || trade.virtualQuoteAfter === undefined)
        return [];
      const deposited =
        trade.virtualQuoteAfter > initial
          ? trade.virtualQuoteAfter - initial
          : 0n;
      const value = Number(formatEther(deposited));
      return Number.isFinite(value) ? [{ time: trade.timestamp, value }] : [];
    })
    .sort((a, b) => a.time - b.time);
}

/** Keep the last known balance at the left edge so a quiet period stays legible. */
export function depositsInRange(
  points: readonly MarketDepositPoint[],
  range: MarketDepositRange,
): MarketDepositPoint[] {
  if (range === "all" || points.length < 2) return [...points];
  const latest = points.at(-1)!;
  const cutoff = latest.time - RANGE_SECONDS[range];
  const prior = points.findLast((point) => point.time < cutoff);
  const visible = points.filter((point) => point.time >= cutoff);
  return prior ? [{ time: cutoff, value: prior.value }, ...visible] : visible;
}

import { formatEther } from "viem";
import type { Token } from "../types";

function targetMarketCap(token: Token) {
  if (token.targetPrice == null) return null;
  try {
    const supply = token.supply
      ? Number(formatEther(BigInt(token.supply)))
      : token.price && token.marketCap != null
        ? token.marketCap / token.price
        : null;
    return supply == null || !Number.isFinite(supply)
      ? null
      : token.targetPrice * supply;
  } catch {
    return null;
  }
}

/** Bonding-curve progress toward graduation, shared by the market page and dashboard. */
export function graduationStats(token: Token) {
  const target = token.graduationTargetWeth
    ? Number(token.graduationTargetWeth)
    : null;
  const quoteTarget =
    target !== null && Number.isFinite(target) && target > 0 ? target : null;
  const quoteRaised = token.curveLiquidityWeth ?? null;
  const quoteProgress =
    quoteTarget !== null && quoteRaised !== null && Number.isFinite(quoteRaised)
      ? (quoteRaised / quoteTarget) * 100
      : null;
  return {
    progress: token.progress ?? 0,
    quoteTarget,
    quoteRaised,
    quoteProgress,
    targetMarketCap: targetMarketCap(token),
  };
}

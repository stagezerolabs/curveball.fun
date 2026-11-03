import { formatEther, type Address } from "viem";

/** Value both sides of a volatile WETH/token pool at its current reserve ratio. */
export function poolLiquidityWeth(
  marketToken: Address,
  quoteToken: Address | undefined,
  token0: Address | undefined,
  token1: Address | undefined,
  reserves: readonly [bigint, bigint, bigint] | undefined,
): number | null {
  if (!quoteToken || !token0 || !token1 || !reserves) return null;
  const market = marketToken.toLowerCase();
  const quote = quoteToken.toLowerCase();
  const first = token0.toLowerCase();
  const second = token1.toLowerCase();
  if (market === quote || !(
    (first === market && second === quote) ||
    (first === quote && second === market)
  )) return null;
  const quoteReserve = first === quote ? reserves[0] : reserves[1];
  return Number(formatEther(quoteReserve)) * 2;
}

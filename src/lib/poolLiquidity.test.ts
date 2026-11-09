import { expect, test } from "bun:test";
import type { Address } from "viem";
import { poolLiquidityWeth } from "./poolLiquidity";

const weth = "0x4200000000000000000000000000000000000006" as Address;
const token = "0xe4EB285D7f496005dcfbFF0259071f7b2eb39C05" as Address;
const other = "0x0000000000000000000000000000000000000001" as Address;

test("values both sides of a graduated pool when WETH is token0", () => {
  expect(
    poolLiquidityWeth(token, weth, weth, token, [
      11022588842279065n,
      145156462142806307540657n,
      0n,
    ]),
  ).toBeCloseTo(0.02204517768455813, 15);
});

test("uses reserve1 when WETH is token1 and ignores unrelated pools", () => {
  const reserves = [145156462142806307540657n, 11022588842279065n, 0n] as const;
  expect(poolLiquidityWeth(token, weth, token, weth, reserves)).toBeCloseTo(
    0.02204517768455813,
    15,
  );
  expect(poolLiquidityWeth(token, weth, other, weth, reserves)).toBeNull();
  expect(poolLiquidityWeth(token, weth, token, other, reserves)).toBeNull();
  expect(poolLiquidityWeth(token, undefined, token, weth, reserves)).toBeNull();
});

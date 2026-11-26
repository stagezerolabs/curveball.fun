import { expect, test } from "bun:test";
import type { Token } from "../types";
import { graduationStats } from "./graduationStats";

const base: Token = {
  address: "0x65014eDD6ea4A53152780742360Fb4685Abab689",
  creator: "0x1111111111111111111111111111111111111111",
  name: "Curveball",
  symbol: "CURVE",
  createdAt: "2026-11-25T00:00:00.000Z",
  graduated: false,
};

test("WETH progress is raised over target", () => {
  const stats = graduationStats({
    ...base,
    progress: 24.4,
    curveLiquidityWeth: 0.2425,
    graduationTargetWeth: "4",
  });
  expect(stats.progress).toBe(24.4);
  expect(stats.quoteTarget).toBe(4);
  expect(stats.quoteRaised).toBe(0.2425);
  expect(stats.quoteProgress).toBeCloseTo(6.0625);
});

test("without a WETH target there is no target progress", () => {
  const stats = graduationStats({ ...base, curveLiquidityWeth: 1 });
  expect(stats.quoteTarget).toBeNull();
  expect(stats.quoteProgress).toBeNull();
});

test("market cap at graduation is target price times supply", () => {
  const stats = graduationStats({
    ...base,
    targetPrice: 0.00001,
    supply: "1000000000000000000000000",
  });
  expect(stats.targetMarketCap).toBeCloseTo(10);
});

test("no target price means no graduation market cap", () => {
  expect(graduationStats(base).targetMarketCap).toBeNull();
});

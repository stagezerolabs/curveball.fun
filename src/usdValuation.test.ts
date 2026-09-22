import { expect, test } from "bun:test";
import { addUsdValuation } from "./usdValuation";

test("adds USD price and fully diluted value without replacing WETH values", () => {
  const valued = addUsdValuation(
    {
      price: 0.00001,
      marketCap: 10,
      peakMarketCap: 12.5,
    },
    {
      usd: 2_637.67,
      updatedAt: "2026-09-19T14:58:30.000Z",
      stale: false,
    },
  );

  expect(valued).toMatchObject({
    price: 0.00001,
    marketCap: 10,
    peakMarketCap: 12.5,
    ethUsd: 2_637.67,
    usdUpdatedAt: "2026-09-19T14:58:30.000Z",
    usdStale: false,
  });
  expect(valued.priceUsd).toBeCloseTo(0.0263767, 9);
  expect(valued.marketCapUsd).toBeCloseTo(26_376.7, 6);
  expect(valued.peakMarketCapUsd).toBeCloseTo(32_970.875, 6);
});

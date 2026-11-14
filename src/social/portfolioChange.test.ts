import { expect, test } from "bun:test";
import { calculateHoldingsChange24h } from "./portfolioChange";

test("weights 24h change by the value of current holdings", () => {
  expect(
    calculateHoldingsChange24h([
      { valueWeth: 110, change24hBps: "1000" },
      { valueWeth: 45, change24hBps: "-1000" },
    ]),
  ).toBeCloseTo((155 / 150 - 1) * 100);
});

test("does not claim a 24h change when a holding lacks price history", () => {
  expect(
    calculateHoldingsChange24h([
      { valueWeth: 1, change24hBps: "1000" },
      { valueWeth: 1, change24hBps: null },
    ]),
  ).toBeNull();
  expect(calculateHoldingsChange24h([])).toBeNull();
});

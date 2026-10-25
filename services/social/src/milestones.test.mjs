import { describe, expect, test } from "bun:test";
import { crossedCurveMilestones } from "./milestones.mjs";

describe("curve milestone notifications", () => {
  test("reports every configured milestone crossed by a buy", () => {
    expect(
      crossedCurveMilestones({
        isBuy: true,
        soldAfter: 720n,
        tokenAmount: 240n,
        curveSupply: 1_000n,
      }),
    ).toEqual([50, 70]);
  });

  test("does not repeat a milestone after it was already crossed", () => {
    expect(
      crossedCurveMilestones({
        isBuy: true,
        soldAfter: 760n,
        tokenAmount: 20n,
        curveSupply: 1_000n,
      }),
    ).toEqual([]);
  });

  test("does not announce downward crossings from sells", () => {
    expect(
      crossedCurveMilestones({
        isBuy: false,
        soldAfter: 690n,
        tokenAmount: 20n,
        curveSupply: 1_000n,
      }),
    ).toEqual([]);
  });

  test("announces a sold-out curve at 100 percent", () => {
    expect(
      crossedCurveMilestones({
        isBuy: true,
        soldAfter: 1_000n,
        tokenAmount: 10n,
        curveSupply: 1_000n,
      }),
    ).toEqual([100]);
  });
});

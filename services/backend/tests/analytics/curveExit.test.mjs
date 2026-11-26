import { describe, expect, test } from "bun:test";

import { exitValue, quoteSellExact } from "../../src/analytics/curveExit.mjs";
import {
  LEADERBOARD_RULES_V3,
  publicRules,
} from "../../src/analytics/leaderboardRules.mjs";

const E = 10n ** 18n;
const midCurve = {
  vT: 900000000n * E,
  vQ: 1111111111111111112n,
  realQuote: 111111111111111112n,
};

describe("quoteSellExact", () => {
  test("matches CurveMath for a mid-curve sell", () => {
    // The spec's combined floor(gross*(10000-106)/10000) gives ...080, 2 wei low;
    // the contract floors fee and tax separately, and the contract wins.
    const quote = quoteSellExact({
      ...midCurve,
      amount: 10000000n * E,
      feeBps: 75n,
      taxBps: 31n,
    });
    expect(quote).toEqual({
      gross: 12210012210012210n,
      fee: 91575091575091n,
      tax: 37851037851037n,
      net: 12080586080586082n,
      error: null,
    });
  });

  test("matches local CURVE market state", () => {
    const vQ = 1307436277414329312n;
    const quote = quoteSellExact({
      vT: 764855631800017662035096229n,
      vQ,
      realQuote: vQ - E,
      amount: 10000000n * E,
      feeBps: 75n,
      taxBps: 0n,
    });
    expect(quote.gross).toBe(16873288697368147n);
    expect(quote.net).toBe(16746739032137886n);
    expect(quote.error).toBeNull();
  });

  test("reports InvalidAmount for a zero sell and never throws", () => {
    expect(
      quoteSellExact({ ...midCurve, amount: 0n, feeBps: 75n, taxBps: 0n })
        .error,
    ).toBe("InvalidAmount");
  });
});

describe("exitValue", () => {
  test("clamps to real reserves", () => {
    const input = {
      vT: 1000000000n * E,
      vQ: E + 1n,
      realQuote: 1n,
      amount: 1000000n * E,
      feeBps: 75n,
      taxBps: 31n,
    };
    const quote = quoteSellExact(input);
    expect(quote.error).toBe("InsufficientReserve");
    expect(quote.gross).toBe(999000999000999n);
    expect(exitValue(input)).toBe(0n);
  });

  test("of a dust amount is zero", () => {
    const input = {
      ...midCurve,
      amount: 100000000000n,
      feeBps: 75n,
      taxBps: 31n,
    };
    const quote = quoteSellExact(input);
    expect(quote.gross).toBe(123n);
    expect(quote.fee).toBe(0n);
    expect(quote.error).toBe("DustTrade");
    expect(exitValue(input)).toBe(0n);
  });

  test("treats null or zero reserves as zero", () => {
    const base = { amount: 10n * E, feeBps: 75n, taxBps: 0n };
    expect(exitValue({ ...base, vT: null, vQ: null, realQuote: null })).toBe(
      0n,
    );
    expect(exitValue({ ...base, vT: 0n, vQ: E, realQuote: E })).toBe(0n);
    expect(exitValue({ ...base, vT: E, vQ: 0n, realQuote: 0n })).toBe(0n);
    expect(exitValue({ ...midCurve, ...base, amount: 0n })).toBe(0n);
  });

  test("equals the contract net for a normal sell", () => {
    expect(
      exitValue({ ...midCurve, amount: 10000000n * E, feeBps: 75n, taxBps: 31n }),
    ).toBe(12080586080586082n);
  });
});

describe("leaderboard rules", () => {
  test("rules object is frozen and publicRules hides internals", () => {
    expect(Object.isFrozen(LEADERBOARD_RULES_V3)).toBe(true);
    expect(LEADERBOARD_RULES_V3.shrinkageK).toBe(8);
    expect(LEADERBOARD_RULES_V3.minQualifyingTradeWei).toBe(
      "5000000000000000",
    );
    const rules = publicRules("consistent");
    expect(rules).toMatchObject({
      minQualifyingTrades: 10,
      minMarkets: 3,
      minActiveDays: 5,
      minTradeWei: "5000000000000000",
      minPeakCapitalWei: "50000000000000000",
      shrinkageK: 8,
      openPositionCapBps: 5000,
    });
    expect(publicRules("new").minPeakCapitalWei).toBe("20000000000000000");
    const serialized = JSON.stringify(
      ["consistent", "new", "trending", "followers"].map((c) => publicRules(c)),
    );
    expect(serialized).not.toMatch(/depth|launch|thin/i);
  });
});

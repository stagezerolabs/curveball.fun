import { describe, expect, test } from "bun:test";

import {
  ceilDiv,
  exitValue,
  markPosition,
  quoteSellExact,
  twapVirtualQuote,
} from "../../src/analytics/curveExit.mjs";
import {
  LEADERBOARD_RULES_PREVIEW,
  LEADERBOARD_RULES_V3,
  publicRules,
  rulesForProfile,
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

describe("TWAP and conservative mark", () => {
  const asOf = 1_800_000_000;
  const H = 3600;
  const history = [
    { at: asOf - 8 * H, vQ: E, vT: 0n },
    { at: asOf - 3 * H, vQ: (12n * E) / 10n, vT: 0n },
  ];

  test("TWAP averages vQ over time", () => {
    expect(twapVirtualQuote(history, asOf, 6 * H)).toBe(1100000000000000000n);
  });

  test("TWAP uses the launch state when the market is younger than the window", () => {
    const young = [
      { at: asOf - 2 * H, vQ: E, vT: 0n },
      { at: asOf - H, vQ: (12n * E) / 10n, vT: 0n },
    ];
    expect(twapVirtualQuote(young, asOf, 6 * H)).toBe(1100000000000000000n);
  });

  test("mark is the lower of current and TWAP exit", () => {
    const k = 900000000n * E * 1111111111111111112n;
    const vQ = (12n * E) / 10n;
    const now = { vQ, vT: ceilDiv(k, vQ), realQuote: vQ - E };
    const amount = 10000000n * E;
    expect(
      exitValue({ ...now, amount, feeBps: 75n, taxBps: 31n }),
    ).toBe(14078418972332017n);
    expect(ceilDiv(now.vT * now.vQ, 1100000000000000000n)).toBe(
      909090909090909091636363637n,
    );
    const mark = markPosition({
      amount,
      now,
      states: history,
      initialVirtualQuote: E,
      feeBps: 75n,
      taxBps: 31n,
      asOfTime: asOf,
      windowSec: 6 * H,
    });
    expect(mark).toBe(11841483679525223n);
  });
});

describe("preview rules profile", () => {
  test("preview is frozen, separately versioned and uncapped", () => {
    expect(Object.isFrozen(LEADERBOARD_RULES_PREVIEW)).toBe(true);
    expect(LEADERBOARD_RULES_PREVIEW.methodologyVersion).toBe(
      "curve-exit-realized-v3-preview",
    );
    expect(LEADERBOARD_RULES_PREVIEW.preview).toBe(true);
    expect(LEADERBOARD_RULES_PREVIEW.openPositionCapBps).toBeNull();
    expect(LEADERBOARD_RULES_PREVIEW.minQualifyingTradeWei).toBe("1000000000000000");
    expect(LEADERBOARD_RULES_PREVIEW.categories.consistent.minQualifyingTrades).toBe(2);
    expect(LEADERBOARD_RULES_V3.preview).toBe(false);
  });

  test("profiles resolve to strict by default and reject typos", () => {
    expect(rulesForProfile(undefined)).toBe(LEADERBOARD_RULES_V3);
    expect(rulesForProfile("")).toBe(LEADERBOARD_RULES_V3);
    expect(rulesForProfile("strict")).toBe(LEADERBOARD_RULES_V3);
    expect(rulesForProfile("preview")).toBe(LEADERBOARD_RULES_PREVIEW);
    expect(() => rulesForProfile("previw")).toThrow(/strict or preview/);
  });

  test("public preview rules say so and carry the preview thresholds", () => {
    const rules = publicRules("consistent", LEADERBOARD_RULES_PREVIEW);
    expect(rules.preview).toBe(true);
    expect(rules.minQualifyingTrades).toBe(2);
    expect(rules.openPositionCapBps).toBeNull();
    expect(publicRules("consistent").preview).toBe(false);
  });
});

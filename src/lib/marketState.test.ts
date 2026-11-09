import { describe, expect, test } from "bun:test";
import {
  GRADUATION_TIMEOUT_SECONDS,
  getMarketDisplayStatus,
  poolTradeAvailability,
  selectTradeState,
  tradeQuoteKey,
  tradeVenueForMarket,
} from "./marketState";

const now = 2_000_000_000;
const base = { graduated: false, paused: false, nowSeconds: now };

test("graduated markets only open pool trading with a pool, adapter, and unpaused factory", () => {
  const token = { graduated: true, lifecycle: "graduated" as const };
  expect(tradeVenueForMarket(token)).toBe("pool-pending");
  const venue = tradeVenueForMarket({
    ...token,
    pool: "0x1111111111111111111111111111111111111111",
  });
  expect(venue).toBe("pool");
  expect(poolTradeAvailability({ venue, paused: false })).toBe(
    "adapter-unavailable",
  );
  expect(
    poolTradeAvailability({
      venue,
      adapter: "0x2222222222222222222222222222222222222222",
    }),
  ).toBe("checking");
  expect(
    poolTradeAvailability({
      venue,
      paused: true,
      adapter: "0x2222222222222222222222222222222222222222",
    }),
  ).toBe("paused");
  expect(
    poolTradeAvailability({
      venue,
      paused: false,
      adapter: "0x2222222222222222222222222222222222222222",
    }),
  ).toBe("open");
  expect(tradeVenueForMarket({ graduated: false, lifecycle: "trading" })).toBe(
    "curve",
  );
});

test("a pool quote is bound to its input, side, and pool", () => {
  const token = {
    address: "0x1111111111111111111111111111111111111111",
    graduated: true,
    pool: "0x2222222222222222222222222222222222222222",
  };
  const quoteKey = tradeQuoteKey(token, "buy", "0.1");
  expect(tradeQuoteKey(token, "sell", "0.1")).not.toBe(quoteKey);
  expect(tradeQuoteKey(token, "buy", "0.2")).not.toBe(quoteKey);
  expect(
    tradeQuoteKey(
      { ...token, pool: "0x3333333333333333333333333333333333333333" },
      "buy",
      "0.1",
    ),
  ).not.toBe(quoteKey);
});

describe("trade state table", () => {
  test.each([
    [
      "trading",
      { ...base, lifecycle: "trading", progress: 40 },
      {
        state: "trading",
        canBuy: true,
        canSell: true,
        sellAborts: false,
        canGraduate: false,
      },
    ],
    [
      "paused trading",
      { ...base, lifecycle: "trading", progress: 40, paused: true },
      {
        state: "trading",
        canBuy: false,
        canSell: true,
        sellAborts: false,
        canGraduate: false,
      },
    ],
    [
      "ready",
      { ...base, lifecycle: "ready", progress: 100, readyAt: now - 60 },
      {
        state: "ready",
        canBuy: false,
        canSell: false,
        sellAborts: false,
        canGraduate: true,
      },
    ],
    [
      "ready one second short of the timeout",
      {
        ...base,
        lifecycle: "ready",
        progress: 100,
        readyAt: now - GRADUATION_TIMEOUT_SECONDS + 1,
      },
      {
        state: "ready",
        canBuy: false,
        canSell: false,
        sellAborts: false,
        canGraduate: true,
      },
    ],
    [
      "ready past the timeout",
      {
        ...base,
        lifecycle: "ready",
        progress: 100,
        readyAt: now - GRADUATION_TIMEOUT_SECONDS,
      },
      {
        state: "overdue",
        canBuy: false,
        canSell: true,
        sellAborts: true,
        canGraduate: true,
      },
    ],
    [
      "paused and overdue",
      {
        ...base,
        lifecycle: "ready",
        progress: 100,
        readyAt: now - GRADUATION_TIMEOUT_SECONDS,
        paused: true,
      },
      {
        state: "overdue",
        canBuy: false,
        canSell: true,
        sellAborts: true,
        canGraduate: true,
      },
    ],
    [
      "aborted below sellout",
      { ...base, lifecycle: "aborted", progress: 97 },
      {
        state: "aborted",
        canBuy: true,
        canSell: true,
        sellAborts: false,
        canGraduate: false,
      },
    ],
    [
      "aborted and sold out again",
      { ...base, lifecycle: "aborted", progress: 100 },
      {
        state: "aborted",
        canBuy: false,
        canSell: true,
        sellAborts: false,
        canGraduate: true,
      },
    ],
    [
      "paused and aborted",
      { ...base, lifecycle: "aborted", progress: 97, paused: true },
      {
        state: "aborted",
        canBuy: false,
        canSell: true,
        sellAborts: false,
        canGraduate: false,
      },
    ],
    [
      "graduated",
      { ...base, graduated: true, lifecycle: "graduated", progress: 100 },
      {
        state: "graduated",
        canBuy: false,
        canSell: false,
        sellAborts: false,
        canGraduate: false,
      },
    ],
  ] as const)("%s", (_name, input, expected) => {
    expect(selectTradeState(input)).toEqual(expected);
  });

  test("tokens cached before lifecycle existed fall back to their graduated and sold-out flags", () => {
    expect(selectTradeState({ ...base, pending: true }).state).toBe("ready");
    expect(selectTradeState({ ...base, graduated: true }).state).toBe(
      "graduated",
    );
    expect(selectTradeState({ ...base, progress: 10 }).state).toBe("trading");
  });
});

test("display status names every lifecycle", () => {
  expect(
    getMarketDisplayStatus({ graduated: false, lifecycle: "trading" }).kind,
  ).toBe("live");
  expect(
    getMarketDisplayStatus({ graduated: false, lifecycle: "ready" }).kind,
  ).toBe("ready");
  expect(
    getMarketDisplayStatus({ graduated: false, lifecycle: "aborted" }).label,
  ).toBe("Graduation aborted");
  expect(
    getMarketDisplayStatus({ graduated: true, lifecycle: "graduated" }).kind,
  ).toBe("graduated");
});

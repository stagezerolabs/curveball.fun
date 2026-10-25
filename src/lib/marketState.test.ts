import { describe, expect, test } from "bun:test";
import {
  GRADUATION_TIMEOUT_SECONDS,
  getMarketDisplayStatus,
  selectTradeState,
} from "./marketState";

const now = 2_000_000_000;
const base = { graduated: false, paused: false, nowSeconds: now };

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

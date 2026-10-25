import { expect, test } from "bun:test";
import { canSubmitLaunch, percentToBps } from "./launchForm";

const ready = {
  name: "My Token",
  symbol: "MYT",
  initialBuy: "",
  launchFee: 400_000_000_000_000n,
  feeAccepted: true,
  artworkUri: "ipfs://bafy" + "a".repeat(55),
  taxPercent: "0",
  reservePercent: "4",
  maxReserveBps: 400,
  taxCapBps: 50,
};

test("a paid launch needs token details and explicit fee consent", () => {
  expect(canSubmitLaunch(ready)).toBe(true);
  expect(canSubmitLaunch({ ...ready, name: "  " })).toBe(false);
  expect(canSubmitLaunch({ ...ready, symbol: "  " })).toBe(false);
  expect(canSubmitLaunch({ ...ready, feeAccepted: false })).toBe(false);
  expect(canSubmitLaunch({ ...ready, launchFee: undefined })).toBe(false);
});

test("optional buy must be a valid nonnegative WETH amount, with or without a first buy", () => {
  expect(canSubmitLaunch({ ...ready, initialBuy: "0" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, initialBuy: "0.01" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, initialBuy: "-0.01" })).toBe(false);
  expect(
    canSubmitLaunch({ ...ready, initialBuy: "0.0000000000000000001" }),
  ).toBe(false);
});

test("a zero-fee launchpad does not ask for fee consent", () => {
  expect(canSubmitLaunch({ ...ready, launchFee: 0n, feeAccepted: false })).toBe(
    true,
  );
});

test("every launch needs published metadata, because the launchpad rejects an empty URI", () => {
  expect(canSubmitLaunch({ ...ready, artworkUri: "" })).toBe(false);
  expect(
    canSubmitLaunch({ ...ready, artworkUri: "https://example.com/meta.json" }),
  ).toBe(false);
});

test("the reserve is capped at the launchpad's MAX_RESERVE_BPS", () => {
  expect(canSubmitLaunch({ ...ready, reservePercent: "0" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, reservePercent: "4.00" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, reservePercent: "4.01" })).toBe(false);
  expect(canSubmitLaunch({ ...ready, reservePercent: "5" })).toBe(false);
  expect(canSubmitLaunch({ ...ready, reservePercent: "" })).toBe(false);
  expect(canSubmitLaunch({ ...ready, maxReserveBps: undefined })).toBe(false);
});

test("the creator tax is capped by the launchpad", () => {
  expect(canSubmitLaunch({ ...ready, taxPercent: "0.5" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, taxPercent: "0.51" })).toBe(false);
  expect(canSubmitLaunch({ ...ready, taxCapBps: undefined })).toBe(false);
});

test("percent inputs convert to whole basis points or are rejected", () => {
  expect(percentToBps("1.25")).toBe(125);
  expect(percentToBps("0.001")).toBeNull();
  expect(percentToBps("-1")).toBeNull();
  expect(percentToBps("abc")).toBeNull();
});

import { expect, test } from "bun:test";
import { canSubmitLaunch } from "./launchForm";

const ready = {
  name: "My Token",
  symbol: "MYT",
  initialBuy: "",
  launchFee: 400_000_000_000_000n,
  feeAccepted: true,
  artworkSelected: false,
  artworkUri: "",
};

test("a paid launch needs token details and explicit fee consent", () => {
  expect(canSubmitLaunch(ready)).toBe(true);
  expect(canSubmitLaunch({ ...ready, name: "  " })).toBe(false);
  expect(canSubmitLaunch({ ...ready, symbol: "  " })).toBe(false);
  expect(canSubmitLaunch({ ...ready, feeAccepted: false })).toBe(false);
  expect(canSubmitLaunch({ ...ready, launchFee: undefined })).toBe(false);
});

test("optional buy must be a valid nonnegative WETH amount", () => {
  expect(canSubmitLaunch({ ...ready, initialBuy: "0" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, initialBuy: "0.01" })).toBe(true);
  expect(canSubmitLaunch({ ...ready, initialBuy: "-0.01" })).toBe(false);
  expect(canSubmitLaunch({ ...ready, initialBuy: "0.0000000000000000001" })).toBe(false);
});

test("a zero-fee factory does not ask for fee consent", () => {
  expect(canSubmitLaunch({ ...ready, launchFee: 0n, feeAccepted: false })).toBe(true);
});

test("selected artwork must have a published metadata URI before a paid launch", () => {
  expect(canSubmitLaunch({ ...ready, artworkSelected: true, artworkUri: "" })).toBe(false);
  expect(canSubmitLaunch({ ...ready, artworkSelected: true, artworkUri: "ipfs://bafy" + "a".repeat(55) })).toBe(true);
});

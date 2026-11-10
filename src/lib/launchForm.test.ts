import { expect, test } from "bun:test";
import { parseEther } from "viem";
import {
  canSubmitLaunch,
  firstBuySpendCap,
  initialBuyFromAvailableBalance,
  launchFundingState,
  LAUNCH_GAS_RESERVE,
  percentToBps,
} from "./launchForm";

const ready = {
  name: "My Token",
  symbol: "MYT",
  initialBuy: "",
  launchFee: 400_000_000_000_000n,
  artworkUri: "ipfs://bafy" + "a".repeat(55),
  taxPercent: "0",
  taxCapBps: 50,
};

test("a paid launch needs token details and a known fee", () => {
  expect(canSubmitLaunch(ready)).toBe(true);
  expect(canSubmitLaunch({ ...ready, name: "  " })).toBe(false);
  expect(canSubmitLaunch({ ...ready, symbol: "  " })).toBe(false);
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

test("ETH-only launch presets reserve the fee and gas before the first buy", () => {
  const eth = parseEther("0.01");
  const fee = parseEther("0.00045");
  const maximum = eth - fee - LAUNCH_GAS_RESERVE;
  expect(initialBuyFromAvailableBalance(0n, eth, fee, 0)).toBe(0n);
  expect(initialBuyFromAvailableBalance(0n, eth, fee, 25)).toBe(maximum / 4n);
  expect(initialBuyFromAvailableBalance(0n, eth, fee, 100)).toBe(maximum);
  expect(launchFundingState(0n, eth, fee, maximum)).toMatchObject({
    canFund: true,
    ethToWrap: fee + maximum,
  });
});

test("launch funding uses existing WETH first and requires ETH for gas", () => {
  const weth = parseEther("0.0002");
  const eth = parseEther("0.001");
  const fee = parseEther("0.00045");
  const buy = parseEther("0.0005");
  expect(launchFundingState(weth, eth, fee, buy)).toMatchObject({
    canFund: true,
    wethUsed: weth,
    ethToWrap: fee + buy - weth,
  });
  expect(initialBuyFromAvailableBalance(weth, eth, fee, 100)).toBe(
    weth + eth - LAUNCH_GAS_RESERVE - fee,
  );
  expect(launchFundingState(parseEther("1"), 0n, fee, 0n).canFund).toBe(false);
  expect(launchFundingState(0n, fee + LAUNCH_GAS_RESERVE - 1n, fee, 0n).canFund).toBe(false);
  expect(initialBuyFromAvailableBalance(0n, fee, fee, 100)).toBe(0n);
});

test("Max does not wrap ETH beyond what the first-buy wallet cap can spend", () => {
  const cap = firstBuySpendCap({
    graduationTarget: parseEther("4"),
    tokenSupply: parseEther("1000000000"),
    curveSupply: parseEther("800000000"),
    walletCapBps: 500,
    feeBps: 75,
    creatorTaxBps: 0,
  });
  expect(cap).toBe(83_229_166_666_666_667n);
  expect(
    initialBuyFromAvailableBalance(
      0n,
      parseEther("1"),
      parseEther("0.00045"),
      100,
      cap,
    ),
  ).toBe(cap);
});

test("a zero-fee launchpad can launch without a fee", () => {
  expect(canSubmitLaunch({ ...ready, launchFee: 0n })).toBe(true);
});

test("every launch needs published metadata, because the launchpad rejects an empty URI", () => {
  expect(canSubmitLaunch({ ...ready, artworkUri: "" })).toBe(false);
  expect(
    canSubmitLaunch({ ...ready, artworkUri: "https://example.com/meta.json" }),
  ).toBe(false);
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

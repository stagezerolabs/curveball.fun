import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatEther } from "viem";
import { AccountBalances } from "./AccountBalances";
import { getBuyFundingState } from "./TradeFundingStatus";
import { NATIVE_GAS_RESERVE } from "../sdk/sdk";

test("account explains a Max buy larger than the displayed ETH balance", () => {
  const nativeBalance = 1_700_000_000_000_000n;
  const wethBalance = 3_137_054_344_860_000n;
  const maxBuy = wethBalance + nativeBalance - NATIVE_GAS_RESERVE;
  expect(maxBuy).toBeGreaterThan(nativeBalance);
  expect(getBuyFundingState(formatEther(maxBuy), wethBalance, nativeBalance)?.canFund).toBe(true);

  const html = renderToStaticMarkup(createElement(AccountBalances, {
    nativeBalance,
    wethBalance,
  }));
  expect(html).toContain("ETH balance");
  expect(html).toContain("0.0017 ETH");
  expect(html).toContain("WETH balance");
  expect(html).toContain("0.0031 WETH");
  expect(html).toContain("Max buys use WETH first, then ETH");
});

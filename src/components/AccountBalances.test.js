import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatEther } from "viem";
import { AccountBalances, combinedBalance } from "./AccountBalances";
import { getBuyFundingState } from "./TradeFundingStatus";
import { NATIVE_GAS_RESERVE } from "../sdk/sdk";

test("account shows one ETH and WETH total and a compact breakdown", () => {
  const nativeBalance = 1_700_000_000_000_000n;
  const wethBalance = 3_137_054_344_860_000n;
  const maxBuy = wethBalance + nativeBalance - NATIVE_GAS_RESERVE;
  expect(maxBuy).toBeGreaterThan(nativeBalance);
  expect(getBuyFundingState(formatEther(maxBuy), wethBalance, nativeBalance)?.canFund).toBe(true);
  expect(combinedBalance(nativeBalance, wethBalance)).toBe(nativeBalance + wethBalance);
  expect(combinedBalance(nativeBalance, undefined)).toBeUndefined();

  const html = renderToStaticMarkup(createElement(AccountBalances, {
    nativeBalance,
    wethBalance,
  }));
  expect(html.match(/<strong/g)).toHaveLength(1);
  expect(html).toContain("0.0017 ETH · 0.0031 WETH");
  expect(html).not.toContain("Max buys");
});

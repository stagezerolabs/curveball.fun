import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseEther } from "viem";
import { TradeFundingStatus } from "./TradeFundingStatus";

test("shows the WETH shortfall that will be wrapped before a buy", () => {
  const html = renderToStaticMarkup(
    <TradeFundingStatus
      amount="1"
      wethBalance={parseEther("0.4")}
      nativeBalance={parseEther("2")}
    />,
  );

  expect(html).toContain("0.4 WETH available");
  expect(html).toContain("0.6 ETH will be wrapped to WETH before buying");
});

test("shows a blocking balance error when ETH cannot fund the WETH shortfall", () => {
  const html = renderToStaticMarkup(
    <TradeFundingStatus
      amount="1"
      wethBalance={parseEther("0.4")}
      nativeBalance={parseEther("0.5")}
    />,
  );

  expect(html).toContain("Not enough ETH to wrap the required WETH and pay network fees");
  expect(html).toContain('role="alert"');
});

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { sideChangeUpdate, useStore } from "./useStore.js";
import { TradeFundingStatus } from "../components/TradeFundingStatus";

test("a fresh trade starts at zero without an insufficient-funds warning", () => {
  const amount = useStore.getState().amount;
  expect(amount).toBe("0");

  const html = renderToStaticMarkup(
    <TradeFundingStatus amount={amount} wethBalance={0n} nativeBalance={0n} />,
  );
  expect(html).not.toContain("Not enough ETH");
  expect(html).not.toContain("WETH available");
});

test("buy funding stays behind the scenes unless the wallet cannot cover the trade", () => {
  const funded = renderToStaticMarkup(
    <TradeFundingStatus
      amount="0.1"
      wethBalance={0n}
      nativeBalance={1_000_000_000_000_000_000n}
    />,
  );
  const insufficient = renderToStaticMarkup(
    <TradeFundingStatus amount="0.1" wethBalance={0n} nativeBalance={0n} />,
  );
  expect(funded).toBe("");
  expect(insufficient).toContain("Not enough ETH to cover this buy");
  expect(insufficient).not.toContain("WETH");
});

test("switching between buy and sell clears the amount", () => {
  expect(sideChangeUpdate({ side: "buy", amount: "0.5" }, "sell").amount).toBe("0");
  expect(sideChangeUpdate({ side: "buy", amount: "0.5" }, "buy").amount).toBe("0.5");
});

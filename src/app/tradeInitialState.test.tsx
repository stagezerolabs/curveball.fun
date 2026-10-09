import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore } from "./useStore.js";
import { TradeFundingStatus } from "../components/TradeFundingStatus";

test("a fresh trade starts at zero without an insufficient-funds warning", () => {
  const amount = useStore.getState().amount;
  expect(amount).toBe("0");

  const html = renderToStaticMarkup(
    <TradeFundingStatus amount={amount} wethBalance={0n} nativeBalance={0n} />,
  );
  expect(html).not.toContain("Not enough ETH");
});

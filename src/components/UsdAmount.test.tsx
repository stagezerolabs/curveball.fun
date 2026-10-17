import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatUsd, UsdAmount } from "./UsdAmount";

test("USD market values stay readable across magnitudes", () => {
  expect(formatUsd(0.000000001)).toBe("<$0.00000001");
  expect(formatUsd(12.5)).toBe("$12.50");
});

test("zero WETH displays as zero USD before an exchange rate loads", () => {
  expect(renderToStaticMarkup(<UsdAmount weth={0} />)).toBe("$0.00");
});

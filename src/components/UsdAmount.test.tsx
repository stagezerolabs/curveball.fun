import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatUsd, UsdAmount } from "./UsdAmount";

test("trade prices keep useful precision below one cent", () => {
  expect(formatUsd(0.000000001, "price")).toBe("$0.000000001");
  expect(formatUsd(0.000000000000001, "price")).toBe("<$0.00000000000001");
  expect(formatUsd(12.5, "price")).toBe("$12.50");
});

test("zero WETH displays as zero USD before an exchange rate loads", () => {
  expect(renderToStaticMarkup(<UsdAmount weth={0} />)).toBe("$0.00");
});

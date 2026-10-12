import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UsdAmount } from "./UsdAmount";

test("zero WETH displays as zero USD before an exchange rate loads", () => {
  expect(renderToStaticMarkup(<UsdAmount weth={0} />)).toBe("$0.00");
});

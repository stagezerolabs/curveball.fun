import { expect, test } from "bun:test";
import { formatSignificantAmount } from "./format.js";

test("WETH displays at five significant figures without losing tiny amounts", () => {
  expect(formatSignificantAmount(0.004790291028740643)).toBe("0.0047903");
  expect(formatSignificantAmount(0.005790291028740643)).toBe("0.0057903");
  expect(formatSignificantAmount(0.000000000000000001)).toBe("1e-18");
  expect(formatSignificantAmount(0)).toBe("0");
});

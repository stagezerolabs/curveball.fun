import { expect, test } from "bun:test";
import { formatSignificantAmount } from "./format.js";

test("WETH displays at five significant figures without losing tiny amounts", () => {
  expect(formatSignificantAmount(0.004790291028740643)).toBe("0.0047903");
  expect(formatSignificantAmount(0.005790291028740643)).toBe("0.0057903");
  expect(formatSignificantAmount(0.000000000000000001)).toBe("1e-18");
  expect(formatSignificantAmount(0)).toBe("0");
});

test("trade amounts stay short enough for the trade panel", async () => {
  const { formatTradeAmount } = await import("./format.js");
  expect(formatTradeAmount(0)).toBe("0");
  expect(formatTradeAmount(801386.181912)).toBe("801,386.18");
  expect(formatTradeAmount(12.3456789)).toBe("12.3457");
  expect(formatTradeAmount(0.0012473304336)).toBe("0.001247");
  expect(formatTradeAmount(0.000000000002)).toBe("0.0₁₁2");
  expect(formatTradeAmount(0.0000012345678)).toBe("0.0₅1235");
  expect(formatTradeAmount(0.0000099999)).toBe("0.0₄1");
});

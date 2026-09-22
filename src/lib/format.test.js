import { expect, test } from "bun:test";
import { formatUsd, formatUsdCompact } from "./format.js";

test("formats both tiny token prices and compact USD valuations", () => {
  expect(formatUsd(0.0263767)).toBe("$0.0263767");
  expect(formatUsd(0.000000123)).toBe("$0.000000123");
  expect(formatUsdCompact(26_376.7)).toBe("$26.38K");
  expect(formatUsd(null)).toBe("—");
});

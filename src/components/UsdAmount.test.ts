import { expect, test } from "bun:test";
import { formatUsd } from "./UsdAmount";

test("trade prices keep useful precision below one cent", () => {
  expect(formatUsd(0.000000001, "price")).toBe("$0.000000001");
  expect(formatUsd(0.000000000000001, "price")).toBe("<$0.00000000000001");
  expect(formatUsd(12.5, "price")).toBe("$12.50");
});

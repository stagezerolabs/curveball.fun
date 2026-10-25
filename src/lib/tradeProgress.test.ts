import { expect, test } from "bun:test";
import { tradeButtonLabel } from "./tradeProgress";

test("buy button names the wallet action and the submitted transaction", () => {
  expect(tradeButtonLabel("buy", null)).toBe("Buy");
  expect(tradeButtonLabel("buy", "wrapWallet")).toBe(
    "Confirm ETH funding in wallet",
  );
  expect(tradeButtonLabel("buy", "approveWallet")).toBe(
    "Approve payment in wallet",
  );
  expect(tradeButtonLabel("buy", "tradeWallet")).toBe("Confirm buy in wallet");
  expect(tradeButtonLabel("buy", "tradeConfirming")).toBe(
    "Buy submitted · waiting for RISE",
  );
});

test("sell button describes token approval and sale", () => {
  expect(tradeButtonLabel("sell", "approveWallet")).toBe(
    "Approve token sale in wallet",
  );
  expect(tradeButtonLabel("sell", "tradeWallet")).toBe(
    "Confirm sell in wallet",
  );
  expect(tradeButtonLabel("sell", "tradeConfirming")).toBe(
    "Sell submitted · waiting for RISE",
  );
});

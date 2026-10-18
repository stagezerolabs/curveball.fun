import { describe, expect, test } from "bun:test";
import { privyConfig } from "./privyConfig";

describe("Privy authentication", () => {
  test("requires wallet login so account creation includes a SIWE ownership signature", () => {
    expect(privyConfig.loginMethods).toEqual(["wallet"]);
    expect(privyConfig.appearance?.walletChainType).toBe("ethereum-only");
  });
});

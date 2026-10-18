import { describe, expect, test } from "bun:test";
import { selectWalletFundingMode } from "./walletFunding";

describe("wallet funding routing", () => {
  test("uses an address-based receive flow for an external wallet on testnet", () => {
    expect(selectWalletFundingMode({
      hasWallet: true,
      walletClientType: "wallet_connect",
      isTestnet: true,
    })).toBe("receive-address");
  });

  test("does not route an external mainnet wallet through Privy crypto deposits", () => {
    expect(selectWalletFundingMode({
      hasWallet: true,
      walletClientType: "metamask",
      isTestnet: false,
    })).toBe("receive-address");
  });

  test("keeps hosted funding available for a Privy-managed mainnet wallet", () => {
    expect(selectWalletFundingMode({
      hasWallet: true,
      walletClientType: "privy",
      isTestnet: false,
    })).toBe("privy-modal");
  });
});

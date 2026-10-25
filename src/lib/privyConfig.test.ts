import { describe, expect, test } from "bun:test";
import { privyConfig } from "./privyConfig";
import { activeChainId, wagmiConfig } from "./web3";

describe("Privy authentication", () => {
  test("requires wallet login so account creation includes a SIWE ownership signature", () => {
    expect(privyConfig.loginMethods).toEqual(["wallet"]);
    expect(privyConfig.appearance?.walletChainType).toBe("ethereum-only");
  });

  test("Privy and Wagmi are configured for the same single chain", () => {
    expect(wagmiConfig.chains.map((chain) => chain.id)).toEqual([
      activeChainId,
    ]);
    expect(privyConfig.defaultChain.id).toBe(activeChainId);
    expect(privyConfig.supportedChains.map((chain) => chain.id)).toEqual([
      activeChainId,
    ]);
  });
});

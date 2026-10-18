import { describe, expect, test } from "bun:test";
import { selectPreferredWallet } from "./PrivyWagmiProvider";

describe("Privy wallet selection", () => {
  test("uses a verified external wallet ahead of an embedded wallet", () => {
    const embedded = { address: "0xembedded", walletClientType: "privy" } as const;
    const external = { address: "0xexternal", walletClientType: "metamask" } as const;

    expect(selectPreferredWallet([embedded, external])).toBe(external);
  });
});

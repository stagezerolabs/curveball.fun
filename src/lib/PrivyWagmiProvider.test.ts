import { describe, expect, test } from "bun:test";
import {
  selectPreferredWallet,
  selectWalletSyncAction,
  walletsOffChain,
} from "./PrivyWagmiProvider";

describe("Privy wallet selection", () => {
  test("uses a verified external wallet ahead of an embedded wallet", () => {
    const embedded = {
      address: "0xembedded",
      walletClientType: "privy",
    } as const;
    const external = {
      address: "0xexternal",
      walletClientType: "metamask",
    } as const;

    expect(selectPreferredWallet([embedded, external])).toBe(external);
  });
});

test("wallet sync disconnects Wagmi once the user logs out, even if Privy still lists a browser wallet", () => {
  expect(
    selectWalletSyncAction({
      ready: true,
      authenticated: false,
      walletCount: 1,
    }),
  ).toBe("clear");
  expect(
    selectWalletSyncAction({
      ready: true,
      authenticated: true,
      walletCount: 0,
    }),
  ).toBe("clear");
  expect(
    selectWalletSyncAction({
      ready: true,
      authenticated: true,
      walletCount: 1,
    }),
  ).toBe("connect");
  expect(
    selectWalletSyncAction({
      ready: false,
      authenticated: false,
      walletCount: 1,
    }),
  ).toBe("wait");
});

test("wallets reporting another chain are listed for a switch to the app chain", () => {
  const onRise = {
    walletClientType: "privy",
    chainId: "eip155:11155931",
  } as const;
  const onMainnet = { walletClientType: "privy", chainId: "eip155:1" } as const;
  expect(walletsOffChain([onRise, onMainnet], 11155931)).toEqual([onMainnet]);
});

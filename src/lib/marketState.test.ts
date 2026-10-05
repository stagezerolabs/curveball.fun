import { describe, expect, test } from "bun:test";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";
import { getBetaReadEnabled, selectMarketState } from "./marketState";

const v2Market = {
  contractVersion: "v2" as const,
  chainId: RISE_TESTNET_CHAIN_ID,
  walletConnected: true,
  publicLaunchOpen: false,
  invited: false,
  graduated: false,
  pending: false,
  progress: 50,
};

describe("beta and market state selection", () => {
  test("uninvited beta blocks creation and buying", () => {
    expect(selectMarketState(v2Market)).toEqual({
      state: "uninvited-beta", hasBetaAccess: false, canCreate: false, canBuy: false,
    });
  });

  test("an invited wallet can create and buy on the curve", () => {
    expect(selectMarketState({ ...v2Market, invited: true })).toEqual({
      state: "invited-beta", hasBetaAccess: true, canCreate: true, canBuy: true,
    });
  });

  test("public launch opens both gates without an invitation", () => {
    expect(selectMarketState({ ...v2Market, publicLaunchOpen: true })).toEqual({
      state: "public", hasBetaAccess: true, canCreate: true, canBuy: true,
    });
  });

  test("v1 on RISE Testnet opens both gates regardless of invite state", () => {
    expect(selectMarketState({ ...v2Market, contractVersion: "v1", invited: false, publicLaunchOpen: false })).toEqual({
      state: "public", hasBetaAccess: true, canCreate: true, canBuy: true,
    });
  });

  test("the v1 escape hatch does not apply on another chain", () => {
    expect(selectMarketState({ ...v2Market, contractVersion: "v1", chainId: 4153 })).toEqual({
      state: "uninvited-beta", hasBetaAccess: false, canCreate: false, canBuy: false,
    });
  });

  test("a disconnected wallet cannot create or buy even when launch is public", () => {
    expect(selectMarketState({ ...v2Market, walletConnected: false, publicLaunchOpen: true })).toEqual({
      state: "public", hasBetaAccess: true, canCreate: false, canBuy: false,
    });
  });

  test("a graduated market cannot be bought on the curve", () => {
    expect(selectMarketState({ ...v2Market, invited: true, graduated: true })).toEqual({
      state: "graduated", hasBetaAccess: true, canCreate: true, canBuy: false,
    });
  });

  test("pending graduation blocks buying while leaving creation open", () => {
    for (const access of [{ invited: true }, { publicLaunchOpen: true }]) {
      expect(selectMarketState({ ...v2Market, ...access, pending: true })).toMatchObject({
        state: "ready", hasBetaAccess: true, canCreate: true, canBuy: false,
      });
    }
  });

  test("v2 progress at or above 100 blocks buying even with beta access", () => {
    for (const progress of [100, 101]) {
      for (const access of [{ invited: true }, { publicLaunchOpen: true }]) {
        expect(selectMarketState({ ...v2Market, ...access, progress })).toMatchObject({
          state: "ready", canCreate: true, canBuy: false,
        });
      }
    }
    expect(selectMarketState({ ...v2Market, invited: true, progress: 99.99 })).toMatchObject({ canBuy: true });
  });

  test("v1 progress does not block buying, while pending still does", () => {
    const v1 = { ...v2Market, contractVersion: "v1" as const, chainId: 4153, invited: true, progress: 100 };
    expect(selectMarketState(v1)).toMatchObject({ state: "invited-beta", canBuy: true });
    expect(selectMarketState({ ...v1, pending: true })).toMatchObject({ state: "ready", canBuy: false });
  });

  test("beta reads retain the v1 testnet bypass and require their original inputs", () => {
    const base = { contractVersion: "v1" as const, chainId: RISE_TESTNET_CHAIN_ID, hasLaunchpadAddress: true, walletConnected: true };
    expect(getBetaReadEnabled(base)).toEqual({ publicLaunchOpen: false, invited: false });
    expect(getBetaReadEnabled({ ...base, contractVersion: "v2" })).toEqual({ publicLaunchOpen: true, invited: true });
    expect(getBetaReadEnabled({ ...base, chainId: 4153 })).toEqual({ publicLaunchOpen: true, invited: true });
    expect(getBetaReadEnabled({ ...base, contractVersion: "v2", walletConnected: false })).toEqual({ publicLaunchOpen: true, invited: false });
    expect(getBetaReadEnabled({ ...base, contractVersion: "v2", hasLaunchpadAddress: false })).toEqual({ publicLaunchOpen: false, invited: false });
  });
});

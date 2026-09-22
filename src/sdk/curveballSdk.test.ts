import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
import { launchpadAbi } from "./contracts";
import {
  CURVEBALL_LAUNCHPAD_ADDRESS,
  RISE_TESTNET_CHAIN_ID,
  applySlippage,
  createDeadline,
  findCreatedToken,
  defineCurveballDeployment,
  validateTokenInput,
  walletNeedsChainSwitch,
} from "./curveballSdk";

describe("Curveball SDK deployment boundary", () => {
  test("ships the canonical RISE Testnet launchpad", () => {
    // The testnet deployment has the same address as the historical mainnet
    // deployment because it used the same deployer nonce. Chain ID separates them.
    expect(CURVEBALL_LAUNCHPAD_ADDRESS).toBe(
      getAddress("0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E"),
    );
    expect(RISE_TESTNET_CHAIN_ID).toBe(11_155_931);
  });

  test("detects a wallet connected to Ethereum instead of RISE", () => {
    expect(walletNeedsChainSwitch(1, RISE_TESTNET_CHAIN_ID)).toBe(true);
    expect(walletNeedsChainSwitch(RISE_TESTNET_CHAIN_ID, RISE_TESTNET_CHAIN_ID)).toBe(false);
    expect(walletNeedsChainSwitch(undefined, RISE_TESTNET_CHAIN_ID)).toBe(true);
  });

  test("accepts a checksummed RISE testnet deployment and derives transaction bounds", () => {
    const launchpad = getAddress("0x1111111111111111111111111111111111111111");
    const deployment = defineCurveballDeployment({
      chainId: RISE_TESTNET_CHAIN_ID,
      launchpad,
      slippageBps: 300,
      deadlineSeconds: 300,
    });

    expect(deployment.launchpad).toBe(launchpad);
    expect(deployment.chainId).toBe(11155931);
    expect(applySlippage(10_000n, deployment.slippageBps)).toBe(9_700n);
  });

  test("rejects a non-RISE chain or unsafe transaction bounds", () => {
    const launchpad = "0x1111111111111111111111111111111111111111";

    expect(() =>
      defineCurveballDeployment({
        chainId: 1,
        launchpad,
        slippageBps: 300,
        deadlineSeconds: 300,
      }),
    ).toThrow("RISE Testnet");
    expect(() =>
      defineCurveballDeployment({
        chainId: RISE_TESTNET_CHAIN_ID,
        launchpad,
        slippageBps: 10_000,
        deadlineSeconds: 300,
      }),
    ).toThrow("slippage");
    expect(() =>
      defineCurveballDeployment({
        chainId: RISE_TESTNET_CHAIN_ID,
        launchpad,
        slippageBps: 300,
        deadlineSeconds: 0,
      }),
    ).toThrow("deadline");
  });
});

describe("Curveball SDK write boundary", () => {
  test("normalizes a bounded token request and derives a five-minute deadline", () => {
    expect(
      validateTokenInput({
        name: "  NominateBear ",
        symbol: " nbr ",
        uri: " https://curveball-fun.netlify.app/api/metadata/nominatebear ",
      }),
    ).toEqual({
      name: "NominateBear",
      symbol: "NBR",
      uri: "https://curveball-fun.netlify.app/api/metadata/nominatebear",
    });
    expect(createDeadline(1_700_000_000_000, 300)).toBe(1_700_000_300n);
  });

  test("rejects token fields that are unsafe to publish permanently", () => {
    expect(() => validateTokenInput({ name: "", symbol: "NBR", uri: "" })).toThrow(
      "name",
    );
    expect(() =>
      validateTokenInput({ name: "NominateBear", symbol: "NBR!", uri: "" }),
    ).toThrow("symbol");
    expect(() =>
      validateTokenInput({
        name: "NominateBear",
        symbol: "NBR",
        uri: "ipfs://not-a-content-identifier",
      }),
    ).toThrow("URI");
  });
});

describe("Curveball SDK receipt boundary", () => {
  test("returns the token created by the confirmed launch transaction", () => {
    const token = getAddress("0x2222222222222222222222222222222222222222");
    const creator = getAddress("0x3333333333333333333333333333333333333333");
    const topics = encodeEventTopics({
      abi: launchpadAbi,
      eventName: "TokenCreated",
      args: { token, creator },
    });
    const data = encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }],
      ["NominateBear", "NBR", "https://curveball-fun.netlify.app/api/metadata/nominatebear"],
    );

    expect(
      findCreatedToken({
        logs: [{ address: token, data, topics }],
      }),
    ).toEqual({ token, creator, name: "NominateBear", symbol: "NBR" });
  });

  test("fails closed when a receipt has no creation event", () => {
    expect(() => findCreatedToken({ logs: [] })).toThrow("TokenCreated");
  });
});

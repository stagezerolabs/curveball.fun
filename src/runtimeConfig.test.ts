import { describe, expect, test } from "bun:test";
import { readChainRuntime } from "./runtimeConfig";

describe("production chain runtime", () => {
  test("requires an explicit RISE deployment and indexer start block", () => {
    expect(() => readChainRuntime({ NODE_ENV: "production" })).toThrow(
      "LAUNCHPAD_ADDRESS",
    );
  });

  test("accepts a complete RISE testnet runtime", () => {
    expect(
      readChainRuntime({
        NODE_ENV: "production",
        RPC_URL: "https://testnet.riselabs.xyz",
        LAUNCHPAD_ADDRESS: "0x1111111111111111111111111111111111111111",
        EXPECTED_CHAIN_ID: "11155931",
        INDEXER_START_BLOCK: "123456",
      }),
    ).toEqual({
      production: true,
      rpcUrl: "https://testnet.riselabs.xyz",
      launchpadAddress: "0x1111111111111111111111111111111111111111",
      expectedChainId: 11155931,
      indexerStartBlock: 123456n,
      contractVersion: "v1",
    });
  });

  test("V2 runtime requires an explicit factory deployment and isolated cursor", () => {
    expect(() => readChainRuntime({ CONTRACT_VERSION: "v2" })).toThrow("LAUNCHPAD_ADDRESS");
    expect(readChainRuntime({ CONTRACT_VERSION: "v2", LAUNCHPAD_ADDRESS: "0x1111111111111111111111111111111111111111" }).contractVersion).toBe("v2");
    expect(() => readChainRuntime({ CONTRACT_VERSION: "v3" })).toThrow("CONTRACT_VERSION");
  });

  test("keeps local development explicit and rejects malformed blocks", () => {
    expect(readChainRuntime({})).toMatchObject({
      production: false,
      expectedChainId: 31337,
      indexerStartBlock: 0n,
    });
    expect(() =>
      readChainRuntime({ INDEXER_START_BLOCK: "-1" }),
    ).toThrow("INDEXER_START_BLOCK");
  });

  test("requires a separate database for a mainnet runtime", () => {
    const mainnet = {
      NODE_ENV: "production",
      RPC_URL: "https://rpc.risechain.com/",
      LAUNCHPAD_ADDRESS: "0x1111111111111111111111111111111111111111",
      EXPECTED_CHAIN_ID: "4153",
      INDEXER_START_BLOCK: "123456",
    };
    expect(() => readChainRuntime(mainnet)).toThrow("MAINNET_DATABASE_URL");
    expect(readChainRuntime({ ...mainnet, MAINNET_DATABASE_URL: "postgresql://example/mainnet" }).expectedChainId).toBe(4153);
    expect(() => readChainRuntime({ ...mainnet,
      MAINNET_DATABASE_URL: "postgresql://example/mainnet",
      LAUNCHPAD_ADDRESS: "0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E",
    })).toThrow("archived mainnet");
  });

  test("rejects noncanonical mainnet chain IDs before database selection", () => {
    for (const value of [" 4153 ", "04153", "+4153", "4153.0"]) {
      expect(() => readChainRuntime({ EXPECTED_CHAIN_ID: value, MAINNET_DATABASE_URL: "postgresql://example/mainnet" })).toThrow("EXPECTED_CHAIN_ID");
    }
  });
});

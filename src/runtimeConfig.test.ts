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
    });
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
});

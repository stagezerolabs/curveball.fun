import { describe, expect, test } from "bun:test";
import { RISE_TESTNET_RPC_URL } from "../sdk/curveballSdk";
import { resolveRiseTestnetRpcUrl, resolveContractVersion } from "./clientRuntime";

describe("browser chain runtime", () => {
  test("V2 requires its own factory and deployment block", () => {
    expect(resolveContractVersion({})).toBe("v1");
    expect(() => resolveContractVersion({ VITE_CONTRACT_VERSION: "v2" })).toThrow("VITE_LAUNCHPAD_ADDRESS");
    expect(() => resolveContractVersion({ VITE_CONTRACT_VERSION: "v2", VITE_LAUNCHPAD_ADDRESS: "0x1111111111111111111111111111111111111111" })).toThrow("VITE_DEPLOYMENT_BLOCK");
    expect(resolveContractVersion({ VITE_CONTRACT_VERSION: "v2", VITE_LAUNCHPAD_ADDRESS: "0x1111111111111111111111111111111111111111", VITE_DEPLOYMENT_BLOCK: "1" })).toBe("v2");
  });
  test("accepts an explicitly configured mainnet RPC", () => {
    expect(
      resolveRiseTestnetRpcUrl({
        VITE_CHAIN_ID: "4153",
        VITE_RPC_URL: "https://rpc.risechain.com/",
      }),
    ).toBe("https://rpc.risechain.com/");
  });

  test("accepts a custom RPC only for the RISE Testnet chain", () => {
    expect(
      resolveRiseTestnetRpcUrl({
        VITE_CHAIN_ID: "11155931",
        VITE_RPC_URL: "https://example.test/rise",
      }),
    ).toBe("https://example.test/rise");
  });

  test("ignores a custom RPC when its chain ID is omitted", () => {
    expect(
      resolveRiseTestnetRpcUrl({
        VITE_RPC_URL: "https://rpc.risechain.com/",
      }),
    ).toBe(RISE_TESTNET_RPC_URL);
  });
});

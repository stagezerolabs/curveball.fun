import { describe, expect, test } from "bun:test";
import { getAddress, parseEther, type Address, type Hash } from "viem";
import type { Config } from "@wagmi/core";
import { defineCurveballDeployment } from "./curveballSdk";
import { createWagmiCurveballSdk } from "./wagmiSdk";
import type { WagmiActions } from "./wagmiSdk";

const account = getAddress("0x1111111111111111111111111111111111111111");
const launchpad = getAddress("0x2222222222222222222222222222222222222222");
const quote = getAddress("0x4200000000000000000000000000000000000006");
const token = getAddress("0x3333333333333333333333333333333333333333");

describe("Curveball SDK buy funding boundary", () => {
  test("wraps only the missing WETH before approving and buying", async () => {
    const writes: Array<{
      address: Address;
      functionName: string;
      value?: bigint;
    }> = [];
    let hashIndex = 0;
    const hashes = [
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`,
      `0x${"3".repeat(64)}`,
    ] as Hash[];

    const actions = {
      getAccount: () => ({ address: account, chainId: 11155931 }),
      getBalance: async () => ({ value: parseEther("2") }),
      readContract: async (_config: Config, parameters: { functionName: string }) => {
        switch (parameters.functionName) {
          case "quote":
            return quote;
          case "balanceOf":
            return parseEther("0.4");
          case "allowance":
            return 0n;
          case "quoteBuy":
            return parseEther("50000");
          default:
            throw new Error(`Unexpected read: ${parameters.functionName}`);
        }
      },
      simulateContract: async (
        _config: Config,
        parameters: { address: Address; functionName: string; value?: bigint },
      ) => ({ request: parameters }),
      writeContract: async (
        _config: Config,
        request: { address: Address; functionName: string; value?: bigint },
      ) => {
        writes.push(request);
        return hashes[hashIndex++];
      },
      waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
      getBytecode: async () => "0x01",
      switchChain: async () => ({ id: 11155931 }),
    };

    const sdk = createWagmiCurveballSdk(
      {} as Config,
      defineCurveballDeployment({ chainId: 11155931, launchpad }),
      actions as unknown as WagmiActions,
    );

    const result = await sdk.trade("buy", token, parseEther("1"));

    expect(writes.map(({ functionName }) => functionName)).toEqual([
      "deposit",
      "approve",
      "buyTokens",
    ]);
    expect(writes[0]).toMatchObject({
      address: quote,
      functionName: "deposit",
      value: parseEther("0.6"),
    });
    expect(result.wrappedAmount).toBe(parseEther("0.6"));
  });

  test("rejects before any write when native ETH cannot fund the WETH shortfall", async () => {
    const writes: string[] = [];
    const actions = {
      getAccount: () => ({ address: account, chainId: 11155931 }),
      getBalance: async () => ({ value: parseEther("0.600001") }),
      readContract: async (_config: Config, parameters: { functionName: string }) => {
        switch (parameters.functionName) {
          case "quote":
            return quote;
          case "balanceOf":
            return parseEther("0.4");
          default:
            throw new Error(`Unexpected read: ${parameters.functionName}`);
        }
      },
      simulateContract: async () => {
        throw new Error("No transaction should be simulated.");
      },
      writeContract: async (_config: Config, request: { functionName: string }) => {
        writes.push(request.functionName);
        return `0x${"1".repeat(64)}` as Hash;
      },
      waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
      getBytecode: async () => "0x01",
      switchChain: async () => ({ id: 11155931 }),
    };
    const sdk = createWagmiCurveballSdk(
      {} as Config,
      defineCurveballDeployment({ chainId: 11155931, launchpad }),
      actions as unknown as WagmiActions,
    );

    await expect(sdk.trade("buy", token, parseEther("1"))).rejects.toThrow(
      "Not enough ETH to wrap the required WETH and pay network fees.",
    );
    expect(writes).toEqual([]);
  });
});

import { expect, test } from "bun:test";
import type { Config } from "@wagmi/core";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseEther, type Hash } from "viem";
import { defineCurveballDeployment } from "./curveballSdk";
import { createV2Sdk } from "./v2Sdk";
import { v2FactoryAbi } from "./v2Contracts";
import type { WagmiActions } from "./wagmiSdk";

const factory = getAddress("0x2222222222222222222222222222222222222222");
const curve = getAddress("0x3333333333333333333333333333333333333333");
const token = getAddress("0x4444444444444444444444444444444444444444");
const quote = getAddress("0x4200000000000000000000000000000000000006");
const account = getAddress("0x1111111111111111111111111111111111111111");

test("V2 buy resolves the token's own curve, wraps the shortfall, and approves that curve", async () => {
  const writes: { address: string; functionName: string; args?: readonly unknown[] }[] = [];
  let buySimulations = 0;
  const actions = {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    getBalance: async () => ({ value: parseEther("2") }),
    readContract: async (_: Config, p: { functionName: string }) => {
      switch (p.functionName) {
        case "market": return [curve, account, 50, 5000, 2500, 0, account];
        case "quote": return quote;
        case "balanceOf": return parseEther("0.4");
        case "allowance": return 0n;
        case "quoteBuy": return [parseEther("100"), parseEther("1"), parseEther("0.995"), parseEther("0.005"), 0n];
        default: throw Error(`Unexpected ${p.functionName}`);
      }
    },
    simulateContract: async (_: Config, p: { functionName: string }) => {
      if (p.functionName === "buyTokens" && ++buySimulations === 1) throw Error("ERC20InsufficientAllowance 0xfb8f41b2 from a stale RPC block");
      return { request: p };
    },
    writeContract: async (_: Config, p: { address: string; functionName: string; args?: readonly unknown[] }) => {
      writes.push(p);
      return `0x${String(writes.length).repeat(64)}` as Hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
    switchChain: async () => ({ id: 11155931 }),
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);

  const result = await sdk.trade("buy", token, parseEther("1"));
  expect(result.quotedOutput).toBe(parseEther("100"));
  expect(writes.map((p) => p.functionName)).toEqual(["deposit", "approve", "buyTokens"]);
  expect(writes[1]).toMatchObject({ address: quote, args: [curve, parseEther("1")] });
  expect(writes[2]).toMatchObject({ address: curve, args: [parseEther("1"), parseEther("97"), expect.any(BigInt)] });
  expect(buySimulations).toBe(2);
});

test("V2 rejects unregistered markets before quoting or writing", async () => {
  const actions = {
    readContract: async () => ["0x0000000000000000000000000000000000000000"],
    writeContract: async () => { throw Error("unexpected write"); },
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  await expect(sdk.quoteTrade("buy", token, 1n)).rejects.toThrow("Unknown Curveball market");
});

test("atomic launch and buy uses a slippage bound from the factory's opening curve", async () => {
  const wrapper = getAddress("0x5555555555555555555555555555555555555555");
  const writes: { address: string; functionName: string; args?: readonly unknown[] }[] = [];
  const actions = {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    getBalance: async () => ({ value: parseEther("20") }),
    readContract: async (_: Config, p: { functionName: string }) => {
      const values: Record<string, unknown> = {
        quote, launchAndBuy: wrapper, supply: parseEther("1000000"), curveSupply: parseEther("800000"),
        initialVQ: parseEther("10"), feeBps: 50, creatorTaxCapBps: 50,
        balanceOf: parseEther("10"), allowance: 0n,
      };
      return values[p.functionName];
    },
    simulateContract: async (_: Config, p: object) => ({ request: p }),
    writeContract: async (_: Config, p: { address: string; functionName: string; args?: readonly unknown[] }) => {
      writes.push(p);
      return `0x${String(writes.length).repeat(64)}` as Hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  await expect(sdk.launchAndBuy({ name: "Nico", symbol: "NICO", uri: "", creatorTaxBps: 25 }, parseEther("1"))).rejects.toThrow("LaunchCreated");
  expect(writes.map((p) => p.functionName)).toEqual(["approve", "launchAndBuy"]);
  expect(writes[0]).toMatchObject({ address: quote, args: [wrapper, parseEther("1")] });
  const request = writes[1].args?.[0] as { maxSpend: bigint; minOut: bigint; creatorTaxBps: number };
  expect(request.maxSpend).toBe(parseEther("1"));
  expect(request.minOut).toBeGreaterThan(0n);
  expect(request.creatorTaxBps).toBe(25);
});

test("graduation reports a confirmed deferral instead of successful preparation", async () => {
  const actions = {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    readContract: async () => [curve, account, 50, 5000, 2500, 0, account],
    simulateContract: async (_: Config, p: object) => ({ request: p }),
    writeContract: async () => `0x${"1".repeat(64)}` as Hash,
    waitForTransactionReceipt: async () => ({ status: "success", logs: [{
      address: factory,
      topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "GraduationDeferred", args: { token } }),
      data: encodeAbiParameters([{ type: "bytes" }], ["0x"]),
    }] }),
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  expect((await sdk.graduate(token)).deferred).toBe(true);
});

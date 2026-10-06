import { expect, test } from "bun:test";
import type { Config } from "@wagmi/core";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseEther, zeroAddress, type Hash } from "viem";
import { defineCurveballDeployment } from "./curveballSdk";
import { createV2Sdk } from "./v2Sdk";
import { v2FactoryAbi } from "./v2Contracts";
import type { WagmiActions } from "./wagmiSdk";

const factory = getAddress("0x2222222222222222222222222222222222222222");
const curve = getAddress("0x3333333333333333333333333333333333333333");
const token = getAddress("0x4444444444444444444444444444444444444444");
const quote = getAddress("0x4200000000000000000000000000000000000006");
const account = getAddress("0x1111111111111111111111111111111111111111");
const icarusPool = getAddress("0x6666666666666666666666666666666666666666");

test("V2 buy resolves the token's own curve, wraps the shortfall, and approves that curve", async () => {
  const writes: { address: string; functionName: string; args?: readonly unknown[] }[] = [];
  let buySimulations = 0;
  let allowance = 0n;
  const actions = {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    getBalance: async () => ({ value: parseEther("2") }),
    readContract: async (_: Config, p: { functionName: string }) => {
      switch (p.functionName) {
        case "market": return [curve, account, 50, 5000, 2500, 0, account];
        case "quote": return quote;
        case "balanceOf": return parseEther("0.4");
        case "allowance": return allowance;
        case "quoteBuy": return [parseEther("100"), parseEther("1"), parseEther("0.995"), parseEther("0.005"), 0n];
        default: throw Error(`Unexpected ${p.functionName}`);
      }
    },
    simulateContract: async (_: Config, p: { functionName: string }) => {
      if (p.functionName === "buyTokens" && ++buySimulations <= 4) throw Error("ERC20InsufficientAllowance 0xfb8f41b2 from a stale RPC block");
      return { request: p };
    },
    writeContract: async (_: Config, p: { address: string; functionName: string; args?: readonly unknown[] }) => {
      writes.push(p);
      if (p.functionName === "approve") allowance = p.args?.[1] as bigint;
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
  expect(buySimulations).toBe(5);
});

test("V2 rejects unregistered markets before quoting or writing", async () => {
  const actions = {
    readContract: async () => ["0x0000000000000000000000000000000000000000"],
    writeContract: async () => { throw Error("unexpected write"); },
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  await expect(sdk.quoteTrade("buy", token, 1n)).rejects.toThrow("Unknown Curveball market");
});

test("V2 does not send a buy when confirmed approval is still unavailable", async () => {
  const writes: string[] = [];
  const actions = {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    getBalance: async () => ({ value: parseEther("2") }),
    readContract: async (_: Config, p: { functionName: string }) => {
      switch (p.functionName) {
        case "market": return [curve, account, 50, 5000, 2500, 0, account];
        case "quote": return quote;
        case "balanceOf": return parseEther("2");
        case "allowance": return 0n;
        default: throw Error(`Unexpected ${p.functionName}`);
      }
    },
    simulateContract: async (_: Config, p: object) => ({ request: p }),
    writeContract: async (_: Config, p: { functionName: string }) => {
      writes.push(p.functionName);
      return `0x${"1".repeat(64)}` as Hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 10n, logs: [] }),
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  await expect(sdk.trade("buy", token, parseEther("1"))).rejects.toThrow("allowance is still unavailable");
  expect(writes).toEqual(["approve"]);
});

test("atomic launch and buy uses a slippage bound from the factory's opening curve", async () => {
  const wrapper = getAddress("0x5555555555555555555555555555555555555555");
  const writes: { address: string; functionName: string; args?: readonly unknown[] }[] = [];
  const progress: string[] = [];
  let allowance = 0n;
  const actions = {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    getBalance: async () => ({ value: parseEther("20") }),
    readContract: async (_: Config, p: { functionName: string }) => {
      const values: Record<string, unknown> = {
        quote, launchAndBuy: wrapper, supply: parseEther("1000000"), curveSupply: parseEther("800000"),
        initialVQ: parseEther("10"), feeBps: 50, creatorTaxCapBps: 50,
        balanceOf: parseEther("10"), allowance,
      };
      return values[p.functionName];
    },
    simulateContract: async (_: Config, p: object) => ({ request: p }),
    writeContract: async (_: Config, p: { address: string; functionName: string; args?: readonly unknown[] }) => {
      writes.push(p);
      if (p.functionName === "approve") allowance = p.args?.[1] as bigint;
      return `0x${String(writes.length).repeat(64)}` as Hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  await expect(sdk.launchAndBuy({ name: "Nico", symbol: "NICO", uri: "", creatorTaxBps: 25 }, parseEther("1"), (phase) => progress.push(phase))).rejects.toThrow("LaunchCreated");
  expect(progress).toEqual(["preparing", "approveWallet", "approveConfirming", "wallet", "confirming"]);
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

function graduationActions(
  state: { sold: bigint; ready: boolean; graduated: boolean; pool?: `0x${string}` },
  receipts: object[][],
  writes: { functionName: string }[],
): WagmiActions {
  let confirmed = 0;
  return {
    getAccount: () => ({ address: account, chainId: 11155931 }),
    readContract: async (_: Config, p: { functionName: string }) => {
      if (p.functionName === "market") return [curve, account, 50, 5000, 2500, 0, account];
      if (p.functionName === "sold") return state.sold;
      if (p.functionName === "curveSupply") return parseEther("800000");
      if (p.functionName === "ready") return state.ready;
      if (p.functionName === "graduated") return state.graduated;
      if (p.functionName === "pool") return state.pool ?? zeroAddress;
      throw Error(`Unexpected ${p.functionName}`);
    },
    simulateContract: async (_: Config, p: object) => ({ request: p }),
    writeContract: async (_: Config, p: { functionName: string }) => {
      writes.push(p);
      return `0x${"2".repeat(64)}` as Hash;
    },
    waitForTransactionReceipt: async () => {
      confirmed += 1;
      return { status: "success", logs: receipts[confirmed - 1] ?? [] };
    },
  } as unknown as WagmiActions;
}

test("graduateToIcarus walks prepare then pool creation and reports the Icarus pool", async () => {
  const writes: { functionName: string }[] = [];
  const startedLog = {
    address: factory,
    topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "GraduationStarted", args: { token, curve } }),
    data: "0x",
  };
  const graduatedLog = {
    address: factory,
    topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "Graduated", args: { token, pool: icarusPool } }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [parseEther("200000"), parseEther("1"), parseEther("200000")],
    ),
  };
  const actions = graduationActions({ sold: parseEther("800000"), ready: false, graduated: false }, [[startedLog], [graduatedLog]], writes);
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  const result = await sdk.graduateToIcarus(token);
  expect(writes.map((p) => p.functionName)).toEqual(["graduate", "createGraduatedPool"]);
  expect(result).toMatchObject({ status: "graduated", already: false, pool: icarusPool, deferredReason: null });
  expect(result.transactions).toHaveLength(2);
  expect(result.tokenLiquidity).toBe(parseEther("200000"));
  expect(result.quoteLiquidity).toBe(parseEther("1"));
});

test("graduateToIcarus reports a deferred preparation with the guard's decoded reason", async () => {
  const writes: { functionName: string }[] = [];
  const reason = `0x08c379a0${encodeAbiParameters([{ type: "string" }], ["Icarus unavailable"]).slice(2)}` as `0x${string}`;
  const deferredLog = {
    address: factory,
    topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "GraduationDeferred", args: { token } }),
    data: encodeAbiParameters([{ type: "bytes" }], [reason]),
  };
  const actions = graduationActions({ sold: parseEther("800000"), ready: false, graduated: false }, [[deferredLog]], writes);
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  const result = await sdk.graduateToIcarus(token);
  expect(writes.map((p) => p.functionName)).toEqual(["graduate"]);
  expect(result).toMatchObject({ status: "deferred", already: false, pool: null, deferredReason: "Icarus unavailable" });
  expect(result.transactions).toHaveLength(1);
});

test("graduateToIcarus sends nothing for an already graduated market", async () => {
  const writes: { functionName: string }[] = [];
  const actions = graduationActions({ sold: parseEther("800000"), ready: false, graduated: true, pool: icarusPool }, [], writes);
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  const result = await sdk.graduateToIcarus(token);
  expect(writes).toEqual([]);
  expect(result).toMatchObject({ status: "graduated", already: true, pool: icarusPool, transactions: [] });
});

test("graduateToIcarus refuses an unsold curve before writing", async () => {
  const writes: { functionName: string }[] = [];
  const actions = graduationActions({ sold: parseEther("400000"), ready: false, graduated: false }, [], writes);
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  await expect(sdk.graduateToIcarus(token)).rejects.toThrow("50% sold");
  expect(writes).toEqual([]);
});

test("graduateToIcarus skips preparation when the curve is already ready", async () => {
  const writes: { functionName: string }[] = [];
  const graduatedLog = {
    address: factory,
    topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "Graduated", args: { token, pool: icarusPool } }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [parseEther("200000"), parseEther("1"), parseEther("200000")],
    ),
  };
  const actions = graduationActions({ sold: parseEther("800000"), ready: true, graduated: false }, [[graduatedLog]], writes);
  const sdk = createV2Sdk({} as Config, defineCurveballDeployment({ chainId: 11155931, launchpad: factory }), actions);
  const result = await sdk.graduateToIcarus(token);
  expect(writes.map((p) => p.functionName)).toEqual(["createGraduatedPool"]);
  expect(result).toMatchObject({ status: "graduated", already: false, pool: icarusPool });
  expect(result.transactions).toHaveLength(1);
});

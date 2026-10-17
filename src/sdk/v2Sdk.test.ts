import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, WaitForTransactionReceiptTimeoutError, type Address, type Hash, type TransactionReceipt } from "viem";
import type { Config } from "wagmi";
import { createV2Sdk } from "./v2Sdk";
import { defineCurveballDeployment, RISE_TESTNET_CHAIN_ID } from "./curveballSdk";
import type { WagmiActions } from "./v2Sdk";
import { v2CurveAbi, v2FactoryAbi } from "./v2Contracts";

const wallet = "0x0000000000000000000000000000000000000001" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const deployment = defineCurveballDeployment({
  chainId: RISE_TESTNET_CHAIN_ID,
  launchpad: "0x0000000000000000000000000000000000000002",
  slippageBps: 300,
  deadlineSeconds: 300,
});

test("buy progress follows each wallet prompt and its network confirmation", async () => {
  const token = "0x0000000000000000000000000000000000000003" as Address;
  const curve = "0x0000000000000000000000000000000000000004" as Address;
  const quote = "0x0000000000000000000000000000000000000005" as Address;
  const phases: string[] = [];
  let approved = false;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    getBalance: async () => ({ value: 1_000_000_000_000_000_000n }),
    readContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "market") return [curve, wallet, 0, 0, 0, 0, wallet];
      if (request.functionName === "quote") return quote;
      if (request.functionName === "balanceOf") return 0n;
      if (request.functionName === "allowance") return approved ? 100n : 0n;
      if (request.functionName === "quoteBuy") return [100n, 100n, 0n, 0n, 0n];
      throw new Error(`Unexpected ${request.functionName}`);
    },
    simulateContract: async (_config: unknown, request: object) => ({ request }),
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "approve") approved = true;
      return hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  } as unknown as WagmiActions;

  await createV2Sdk({} as Config, deployment, actions).trade("buy", token, 100n, (phase) => phases.push(phase));
  expect(phases).toEqual([
    "preparing", "wrapWallet", "wrapConfirming", "approveWallet", "approveConfirming", "tradeWallet", "tradeConfirming",
  ]);
});

test("sell all for ETH approves the full balance, sells, then unwraps only the sale proceeds", async () => {
  const token = "0x0000000000000000000000000000000000000003" as Address;
  const curve = "0x0000000000000000000000000000000000000004" as Address;
  const quote = "0x0000000000000000000000000000000000000005" as Address;
  const balance = 123n;
  const net = 45n;
  const calls: Array<{ functionName: string; args?: readonly unknown[]; address?: Address }> = [];
  let approved = false;
  const saleReceipt = {
    status: "success",
    logs: [{
      address: curve,
      topics: encodeEventTopics({ abi: v2CurveAbi, eventName: "Trade", args: { token, trader: wallet } }),
      data: encodeAbiParameters([
        { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" },
      ], [false, 50n, net, 3n, 2n, balance, 100n, 100n, 0n]),
    }],
  } as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "market") return [curve, wallet, 0, 0, 0, 0, wallet];
      if (request.functionName === "quote") return quote;
      if (request.functionName === "balanceOf") return balance;
      if (request.functionName === "allowance") return approved ? balance : 0n;
      if (request.functionName === "quoteSell") return [net, 50n, 3n, 2n];
      throw new Error(`Unexpected ${request.functionName}`);
    },
    simulateContract: async (_config: unknown, request: { functionName: string; args?: readonly unknown[]; address?: Address }) => {
      calls.push(request);
      return { request };
    },
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "approve") approved = true;
      return hash;
    },
    waitForTransactionReceipt: async (_config: unknown, request: { hash: Hash }) =>
      calls.some((call) => call.functionName === "withdraw") ? { status: "success", logs: [] } : request.hash === hash && calls.some((call) => call.functionName === "sellTokens") ? saleReceipt : { status: "success", logs: [] },
  } as unknown as WagmiActions;

  const result = await createV2Sdk({} as Config, deployment, actions).sellAllForEth(token, quote);
  expect(result.amount).toBe(net);
  expect(result.sale.marketState).toEqual({ sold: 0n, virtualQuote: 100n, virtualToken: 100n });
  expect(calls.map((call) => call.functionName)).toEqual(["approve", "sellTokens", "withdraw"]);
  expect(calls[0].args).toEqual([curve, balance]);
  expect(calls[1].args?.[0]).toBe(balance);
  expect(calls[2].address).toBe(quote);
  expect(calls[2].args).toEqual([net]);
});

test("a rejected unwrap reports the confirmed sale and can be retried without selling twice", async () => {
  const token = "0x0000000000000000000000000000000000000003" as Address;
  const curve = "0x0000000000000000000000000000000000000004" as Address;
  const quote = "0x0000000000000000000000000000000000000005" as Address;
  const net = 45n;
  const writes: string[] = [];
  const phases: string[] = [];
  let rejectUnwrap = true;
  const saleReceipt = {
    status: "success",
    logs: [{
      address: curve,
      topics: encodeEventTopics({ abi: v2CurveAbi, eventName: "Trade", args: { token, trader: wallet } }),
      data: encodeAbiParameters([
        { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" },
      ], [false, 50n, net, 3n, 2n, 123n, 100n, 100n, 0n]),
    }],
  } as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "market") return [curve, wallet, 0, 0, 0, 0, wallet];
      if (request.functionName === "quote") return quote;
      if (request.functionName === "balanceOf") return 123n;
      if (request.functionName === "allowance") return 123n;
      if (request.functionName === "quoteSell") return [net, 50n, 3n, 2n];
      throw new Error(`Unexpected ${request.functionName}`);
    },
    simulateContract: async (_config: unknown, request: object) => ({ request }),
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      writes.push(request.functionName);
      if (request.functionName === "withdraw" && rejectUnwrap) throw new Error("User rejected unwrap");
      return hash;
    },
    waitForTransactionReceipt: async () => writes.at(-1) === "sellTokens" ? saleReceipt : { status: "success", logs: [] },
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, deployment, actions);
  let saleAmount: bigint | undefined;
  await expect(sdk.sellAllForEth(token, quote, (phase, amount) => {
    phases.push(phase);
    if (phase === "sold") saleAmount = amount;
  })).rejects.toThrow("User rejected unwrap");

  expect(saleAmount).toBe(net);
  expect(phases).toContain("sold");
  rejectUnwrap = false;
  await sdk.unwrapWeth(saleAmount!, quote);
  expect(writes).toEqual(["sellTokens", "withdraw", "withdraw"]);
});

test("a missing launch transaction cannot leave confirmation waiting forever", async () => {
  let receiptChecked = false;
  let requestedTimeout: number | undefined;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: async () => 0n,
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => hash,
    waitForTransactionReceipt: async (_config: unknown, options: { timeout?: number }) => {
      requestedTimeout = options.timeout;
      if (!options.timeout) return new Promise<never>(() => {});
      throw new WaitForTransactionReceiptTimeoutError({ hash });
    },
    getTransactionReceipt: async () => {
      receiptChecked = true;
      throw new Error("Transaction not found");
    },
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, deployment, actions);

  const outcome = await Promise.race([
    sdk.createToken({ name: "Test", symbol: "TST", uri: "" }).then(() => "confirmed", (error: Error) => error.name),
    new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 100)),
  ]);

  expect(outcome).toBe("PendingTransactionError");
  expect(receiptChecked).toBe(true);
  expect(requestedTimeout).toBe(120_000);
});

test("a receipt found after the waiter fails still completes the launch", async () => {
  const token = "0x0000000000000000000000000000000000000003" as Address;
  const curve = "0x0000000000000000000000000000000000000004" as Address;
  const receipt = {
    status: "success",
    logs: [{
      address: deployment.launchpad,
      topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "LaunchCreated", args: { token, curve, creator: wallet } }),
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }], ["Test", "TST", ""]),
    }],
  } as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: async () => 0n,
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => { throw new WaitForTransactionReceiptTimeoutError({ hash }); },
    getTransactionReceipt: async () => receipt,
  } as unknown as WagmiActions;

  const result = await createV2Sdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri: "" });
  expect(result.token).toBe(token);
  expect(result.hash).toBe(hash);
});

test("a reverted receipt found after the waiter fails is reported as a failure", async () => {
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: async () => 0n,
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => { throw new WaitForTransactionReceiptTimeoutError({ hash }); },
    getTransactionReceipt: async () => ({ status: "reverted", logs: [] }),
  } as unknown as WagmiActions;

  await expect(createV2Sdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri: "" }))
    .rejects.toThrow(`Transaction ${hash} reverted.`);
});

test("a paid launch wraps and approves only the exact fee before creation", async () => {
  const fee = 400_000_000_000_000n;
  const quote = "0x0000000000000000000000000000000000000005" as Address;
  const token = "0x0000000000000000000000000000000000000003" as Address;
  const curve = "0x0000000000000000000000000000000000000004" as Address;
  const simulations: Array<{ functionName: string; args?: readonly unknown[]; value?: bigint }> = [];
  let approved = false;
  const receipt = {
    status: "success",
    logs: [{
      address: deployment.launchpad,
      topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "LaunchCreated", args: { token, curve, creator: wallet } }),
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }], ["Test", "TST", ""]),
    }],
  } as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    getBalance: async () => ({ value: 1n * 10n ** 18n }),
    readContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "launchFee") return fee;
      if (request.functionName === "quote") return quote;
      if (request.functionName === "balanceOf") return 0n;
      if (request.functionName === "allowance") return approved ? fee : 0n;
      throw new Error(`Unexpected ${request.functionName}`);
    },
    simulateContract: async (_config: unknown, request: { functionName: string; args?: readonly unknown[]; value?: bigint }) => {
      simulations.push(request);
      return { request };
    },
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "approve") approved = true;
      return hash;
    },
    waitForTransactionReceipt: async () => receipt,
  } as unknown as WagmiActions;

  await createV2Sdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri: "" });
  expect(simulations.map((request) => request.functionName)).toEqual(["deposit", "approve", "createToken"]);
  expect(simulations[0].value).toBe(fee);
  expect(simulations[1].args).toEqual([deployment.launchpad, fee]);
});

test("reserve-enabled direct and atomic launches carry the selected percentage", async () => {
  const token = "0x0000000000000000000000000000000000000003" as Address;
  const curve = "0x0000000000000000000000000000000000000004" as Address;
  const quote = "0x0000000000000000000000000000000000000005" as Address;
  const wrapper = "0x0000000000000000000000000000000000000006" as Address;
  const reserve = "0x0000000000000000000000000000000000000007" as Address;
  const requests: Array<{ functionName: string; args?: readonly unknown[] }> = [];
  const receipt = {
    status: "success",
    logs: [{
      address: deployment.launchpad,
      topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "LaunchCreated", args: { token, curve, creator: wallet } }),
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }], ["Test", "TST", ""]),
    }],
  } as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "holderReserve") return reserve;
      if (request.functionName === "launchFee") return 0n;
      if (request.functionName === "quote") return quote;
      if (request.functionName === "launchAndBuy") return wrapper;
      if (request.functionName === "supply") return 1_000_000n * 10n ** 18n;
      if (request.functionName === "curveSupply") return 800_000n * 10n ** 18n;
      if (request.functionName === "initialVQ") return 10n * 10n ** 18n;
      if (request.functionName === "feeBps") return 75;
      if (request.functionName === "creatorTaxCapBps") return 50;
      if (request.functionName === "balanceOf" || request.functionName === "allowance") return 50n * 10n ** 18n;
      throw new Error(`Unexpected ${request.functionName}`);
    },
    simulateContract: async (_config: unknown, request: { functionName: string; args?: readonly unknown[] }) => {
      requests.push(request);
      return { request };
    },
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => receipt,
  } as unknown as WagmiActions;
  const sdk = createV2Sdk({} as Config, deployment, actions);
  await sdk.createToken({ name: "Test", symbol: "TST", uri: "", holderReserveBps: 250 });
  await sdk.launchAndBuy({ name: "Test", symbol: "TST", uri: "", holderReserveBps: 500 }, 50n * 10n ** 18n);
  expect(requests[0].args).toEqual(["Test", "TST", "", 0, 250]);
  expect((requests[1].args?.[0] as { holderReserveBps: number }).holderReserveBps).toBe(500);
  await expect(sdk.createToken({ name: "Test", symbol: "TST", uri: "", holderReserveBps: 501 })).rejects.toThrow("0–5%");
});

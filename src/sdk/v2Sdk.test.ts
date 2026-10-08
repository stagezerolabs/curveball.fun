import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, WaitForTransactionReceiptTimeoutError, type Address, type Hash, type TransactionReceipt } from "viem";
import type { Config } from "@wagmi/core";
import { createV2Sdk } from "./v2Sdk";
import { defineCurveballDeployment, RISE_TESTNET_CHAIN_ID } from "./curveballSdk";
import type { WagmiActions } from "./wagmiSdk";
import { v2FactoryAbi } from "./v2Contracts";

const wallet = "0x0000000000000000000000000000000000000001" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const deployment = defineCurveballDeployment({
  chainId: RISE_TESTNET_CHAIN_ID,
  launchpad: "0x0000000000000000000000000000000000000002",
  slippageBps: 300,
  deadlineSeconds: 300,
});

test("a missing launch transaction cannot leave confirmation waiting forever", async () => {
  let receiptChecked = false;
  let requestedTimeout: number | undefined;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
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
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => { throw new WaitForTransactionReceiptTimeoutError({ hash }); },
    getTransactionReceipt: async () => ({ status: "reverted", logs: [] }),
  } as unknown as WagmiActions;

  await expect(createV2Sdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri: "" }))
    .rejects.toThrow(`Transaction ${hash} reverted.`);
});

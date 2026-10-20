import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseEther, WaitForTransactionReceiptTimeoutError, type Address, type Hash, type Log, type TransactionReceipt } from "viem";
import type { Config } from "wagmi";
import { createCurveballSdk, quoteFirstBuy, TOKEN_SUPPLY } from "./sdk";
import { defineCurveballDeployment, RISE_TESTNET_CHAIN_ID } from "./curveballSdk";
import type { WagmiActions } from "./sdk";
import { curveLaunchpadAbi } from "./contracts";

const wallet = "0x0000000000000000000000000000000000000001" as Address;
const token = "0x0000000000000000000000000000000000000003" as Address;
const quote = "0x0000000000000000000000000000000000000005" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const uri = "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const deployment = defineCurveballDeployment({
  chainId: RISE_TESTNET_CHAIN_ID,
  launchpad: "0x0000000000000000000000000000000000000002",
  slippageBps: 300,
  deadlineSeconds: 300,
});
const market = {
  creator: wallet, feeBps: 75, creatorShareBps: 5_000, buybackShareBps: 2_500, taxBps: 0, state: 1,
  virtualToken: TOKEN_SUPPLY, virtualQuote: 2_500_000_000_000_000n, initialVirtualQuote: 2_500_000_000_000_000n,
  realQuote: 0n, reserveTokens: 0n, readyAt: 0, pool: "0x0000000000000000000000000000000000000000",
};

function tradeLog(isBuy: boolean, quoteAmount: bigint, tokenAmount: bigint, virtualToken: bigint, virtualQuote: bigint) {
  return {
    address: deployment.launchpad,
    topics: encodeEventTopics({ abi: curveLaunchpadAbi, eventName: "Trade", args: { token, trader: wallet } }),
    data: encodeAbiParameters(
      [{ type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [isBuy, quoteAmount, tokenAmount, 3n, 2n, virtualToken, virtualQuote],
    ),
  } as unknown as Log;
}

function launchLog() {
  return {
    address: deployment.launchpad,
    topics: encodeEventTopics({ abi: curveLaunchpadAbi, eventName: "LaunchCreated", args: { token, creator: wallet } }),
    data: encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint256" }],
      ["Test", "TST", uri, 75, 5_000, 2_500, 0, 0n],
    ),
  } as unknown as Log;
}

/** Reads the launchpad's launch policy plus any overrides. */
function reads(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    market, quoteToken: quote, launchFee: 0n, graduationTarget: parseEther("0.01"), MAX_RESERVE_BPS: 400n,
    feeDefaults: [75, 5_000, 2_500, 50], ...overrides,
  };
  return async (_config: unknown, request: { functionName: string }) => {
    if (!(request.functionName in values)) throw new Error(`Unexpected ${request.functionName}`);
    const value = values[request.functionName];
    return typeof value === "function" ? value() : value;
  };
}

test("a first buy is quoted exactly as the launchpad filled it on testnet", () => {
  // The smoke launch: 0.003 WETH at a 0.01 target, 75 bps fee and no tax received this many tokens.
  expect(quoteFirstBuy(3_000_000_000_000_000n, parseEther("0.01"), 75, 0)).toBe(543_601_359_003_397_503_945_291n);
  expect(quoteFirstBuy(parseEther("100"), parseEther("0.01"), 75, 0)).toBe(800_000n * 10n ** 18n);
});

test("buy progress follows each wallet prompt and its network confirmation, approving the launchpad", async () => {
  const phases: string[] = [];
  const simulations: Array<{ functionName: string; args?: readonly unknown[]; address?: Address }> = [];
  let approved = false;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    getBalance: async () => ({ value: 10n ** 18n }),
    readContract: reads({
      balanceOf: 0n,
      allowance: () => approved ? 100n : 0n,
      previewBuy: { tokensOut: 100n, spent: 100n, curveQuote: 99n, fee: 1n, tax: 0n },
    }),
    simulateContract: async (_config: unknown, request: { functionName: string; args?: readonly unknown[]; address?: Address }) => {
      simulations.push(request);
      return { request };
    },
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "approve") approved = true;
      return hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  } as unknown as WagmiActions;

  const result = await createCurveballSdk({} as Config, deployment, actions).trade("buy", token, 100n, (phase) => phases.push(phase));
  expect(phases).toEqual(["preparing", "wrapWallet", "wrapConfirming", "approveWallet", "approveConfirming", "tradeWallet", "tradeConfirming"]);
  expect(simulations.map((call) => call.functionName)).toEqual(["deposit", "approve", "buy"]);
  expect(simulations[1].args).toEqual([deployment.launchpad, 100n]);
  expect(simulations[2].address).toBe(deployment.launchpad);
  expect(simulations[2].args?.slice(0, 3)).toEqual([token, 100n, 97n]);
  expect(result.wrappedAmount).toBe(100n);
});

test("sell all for ETH approves the full balance, sells, then unwraps only the sale proceeds", async () => {
  const balance = 123n;
  const net = 45n;
  const calls: Array<{ functionName: string; args?: readonly unknown[]; address?: Address }> = [];
  let approved = false;
  const saleReceipt = { status: "success", logs: [tradeLog(false, net, balance, 900n, 100n)] } as unknown as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads({
      balanceOf: balance,
      allowance: () => approved ? balance : 0n,
      previewSell: { net, gross: 50n, fee: 3n, tax: 2n },
    }),
    simulateContract: async (_config: unknown, request: { functionName: string; args?: readonly unknown[]; address?: Address }) => {
      calls.push(request);
      return { request };
    },
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "approve") approved = true;
      return hash;
    },
    waitForTransactionReceipt: async () => calls.at(-1)?.functionName === "sell" ? saleReceipt : { status: "success", logs: [] },
  } as unknown as WagmiActions;

  const result = await createCurveballSdk({} as Config, deployment, actions).sellAllForEth(token, quote);
  expect(result.amount).toBe(net);
  expect(result.sale.marketState).toEqual({ sold: TOKEN_SUPPLY - 900n, virtualQuote: 100n, virtualToken: 900n });
  expect(calls.map((call) => call.functionName)).toEqual(["approve", "sell", "withdraw"]);
  expect(calls[0].address).toBe(token);
  expect(calls[0].args).toEqual([deployment.launchpad, balance]);
  expect(calls[1].args?.slice(0, 2)).toEqual([token, balance]);
  expect(calls[2].address).toBe(quote);
  expect(calls[2].args).toEqual([net]);
});

test("a rejected unwrap reports the confirmed sale and can be retried without selling twice", async () => {
  const net = 45n;
  const writes: string[] = [];
  const phases: string[] = [];
  let rejectUnwrap = true;
  const saleReceipt = { status: "success", logs: [tradeLog(false, net, 123n, 900n, 100n)] } as unknown as TransactionReceipt;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads({ balanceOf: 123n, allowance: 123n, previewSell: { net, gross: 50n, fee: 3n, tax: 2n } }),
    simulateContract: async (_config: unknown, request: object) => ({ request }),
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      writes.push(request.functionName);
      if (request.functionName === "withdraw" && rejectUnwrap) throw new Error("User rejected unwrap");
      return hash;
    },
    waitForTransactionReceipt: async () => writes.at(-1) === "sell" ? saleReceipt : { status: "success", logs: [] },
  } as unknown as WagmiActions;
  const sdk = createCurveballSdk({} as Config, deployment, actions);
  let saleAmount: bigint | undefined;
  await expect(sdk.sellAllForEth(token, quote, (phase, amount) => {
    phases.push(phase);
    if (phase === "sold") saleAmount = amount;
  })).rejects.toThrow("User rejected unwrap");

  expect(saleAmount).toBe(net);
  expect(phases).toContain("sold");
  rejectUnwrap = false;
  await sdk.unwrapWeth(saleAmount!, quote);
  expect(writes).toEqual(["sell", "withdraw", "withdraw"]);
});

test("a missing launch transaction cannot leave confirmation waiting forever", async () => {
  let receiptChecked = false;
  let requestedTimeout: number | undefined;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads(),
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
  const sdk = createCurveballSdk({} as Config, deployment, actions);

  const outcome = await Promise.race([
    sdk.createToken({ name: "Test", symbol: "TST", uri }).then(() => "confirmed", (error: Error) => error.name),
    new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 100)),
  ]);

  expect(outcome).toBe("PendingTransactionError");
  expect(receiptChecked).toBe(true);
  expect(requestedTimeout).toBe(120_000);
});

test("a receipt found after the waiter fails still completes the launch", async () => {
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads(),
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => { throw new WaitForTransactionReceiptTimeoutError({ hash }); },
    getTransactionReceipt: async () => ({ status: "success", logs: [launchLog()] }),
  } as unknown as WagmiActions;

  const result = await createCurveballSdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri });
  expect(result.token).toBe(token);
  expect(result.creator).toBe(wallet);
  expect(result.hash).toBe(hash);
});

test("a reverted receipt found after the waiter fails is reported as a failure", async () => {
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads(),
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => { throw new WaitForTransactionReceiptTimeoutError({ hash }); },
    getTransactionReceipt: async () => ({ status: "reverted", logs: [] }),
  } as unknown as WagmiActions;

  await expect(createCurveballSdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri }))
    .rejects.toThrow(`Transaction ${hash} reverted.`);
});

test("a launch wraps and approves the fee plus the first buy, then calls launch once", async () => {
  const fee = parseEther("0.001");
  const initialBuy = parseEther("0.003");
  const simulations: Array<{ functionName: string; args?: readonly unknown[]; value?: bigint }> = [];
  let approved = false;
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    getBalance: async () => ({ value: 10n ** 18n }),
    readContract: reads({ launchFee: fee, balanceOf: 0n, allowance: () => approved ? fee + initialBuy : 0n }),
    simulateContract: async (_config: unknown, request: { functionName: string; args?: readonly unknown[]; value?: bigint }) => {
      simulations.push(request);
      return { request };
    },
    writeContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "approve") approved = true;
      return hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [launchLog()] }),
  } as unknown as WagmiActions;

  const result = await createCurveballSdk({} as Config, deployment, actions)
    .launchAndBuy({ name: "Test", symbol: "TST", uri, holderReserveBps: 100 }, initialBuy);
  expect(simulations.map((request) => request.functionName)).toEqual(["deposit", "approve", "launch"]);
  expect(simulations[0].value).toBe(fee + initialBuy);
  expect(simulations[1].args).toEqual([deployment.launchpad, fee + initialBuy]);
  const expectedMinOut = 543_601_359_003_397_503_945_291n * 9_700n / 10_000n;
  expect(simulations[2].args).toEqual([{ name: "Test", symbol: "TST", uri }, 0, 100, initialBuy, expectedMinOut]);
  expect(result.minimumOutput).toBe(expectedMinOut);
});

test("launch limits come from the launchpad: reserve cap, tax cap, and a required metadata URI", async () => {
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads(),
  } as unknown as WagmiActions;
  const sdk = createCurveballSdk({} as Config, deployment, actions);
  await expect(sdk.createToken({ name: "Test", symbol: "TST", uri, holderReserveBps: 401 })).rejects.toThrow("0–4%");
  await expect(sdk.createToken({ name: "Test", symbol: "TST", uri, creatorTaxBps: 51 })).rejects.toThrow("0–0.5%");
  await expect(sdk.createToken({ name: "Test", symbol: "TST", uri: "" })).rejects.toThrow("metadata URI is required");
});

test("claims and keeper actions go to the singleton that owns them", async () => {
  const escrow = "0x00000000000000000000000000000000000000e1" as Address;
  const locker = "0x00000000000000000000000000000000000000e2" as Address;
  const reserve = "0x00000000000000000000000000000000000000e3" as Address;
  const pool = "0x00000000000000000000000000000000000000f1" as Address;
  const calls: Array<{ address: Address; functionName: string; args: readonly unknown[] }> = [];
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID }),
    readContract: reads({ escrow, locker, reserve, tokenOf: token }),
    simulateContract: async (_config: unknown, request: { address: Address; functionName: string; args: readonly unknown[] }) => {
      calls.push(request);
      return { request };
    },
    writeContract: async () => hash,
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  } as unknown as WagmiActions;
  const sdk = createCurveballSdk({} as Config, deployment, actions);

  await sdk.claimEscrow(quote);
  await sdk.claimPoolFees(pool);
  await sdk.claimReserve(token);
  await sdk.buyback(token);
  await sdk.graduate(token);
  await sdk.abortGraduation(token);
  expect(calls.map(({ address, functionName, args }) => [address, functionName, args])).toEqual([
    [escrow, "claim", [quote]],
    [locker, "claim", [pool]],
    [reserve, "claim", [token]],
    [escrow, "buyback", [token]],
    [deployment.launchpad, "graduate", [token]],
    [deployment.launchpad, "abortGraduation", [token]],
  ]);
});

test("a wallet whose provider is still on chain 1 is switched before the launch is sent", async () => {
  // Privy's embedded wallet provider starts on chain 1 while Wagmi's cached connection can already say RISE.
  let providerChainId = 1;
  const switched: number[] = [];
  const actions = {
    getAccount: () => ({
      address: wallet,
      chainId: RISE_TESTNET_CHAIN_ID,
      connector: { getChainId: async () => providerChainId },
    }),
    switchChain: async (_config: Config, { chainId }: { chainId: number }) => {
      switched.push(chainId);
      providerChainId = chainId;
      return { id: chainId };
    },
    readContract: reads(),
    simulateContract: async () => ({ request: {} }),
    writeContract: async () => {
      if (providerChainId !== RISE_TESTNET_CHAIN_ID) {
        throw new Error(`The current chain of the wallet (id: ${providerChainId}) does not match the target chain for the transaction (id: ${RISE_TESTNET_CHAIN_ID} – RISE Testnet).`);
      }
      return hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [launchLog()] }),
  } as unknown as WagmiActions;

  const result = await createCurveballSdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri });
  expect(switched).toEqual([RISE_TESTNET_CHAIN_ID]);
  expect(result.token).toBe(token);
});

test("a launch rechecks the same wallet connector when its provider changes before signing", async () => {
  let providerChainId: number = RISE_TESTNET_CHAIN_ID;
  const connector = { uid: "launch-wallet", getChainId: async () => providerChainId };
  const switched: Array<{ chainId: number; connector?: unknown }> = [];
  const actions = {
    getAccount: () => ({ address: wallet, chainId: RISE_TESTNET_CHAIN_ID, connector }),
    switchChain: async (_config: Config, request: { chainId: number; connector?: unknown }) => {
      switched.push(request);
      if (request.connector === connector) providerChainId = request.chainId;
      return { id: request.chainId };
    },
    readContract: reads(),
    simulateContract: async (_config: unknown, request: object) => {
      // Privy's provider can finish initializing after the SDK's initial check and fall back to chain 1.
      providerChainId = 1;
      return { request };
    },
    writeContract: async (_config: unknown, request: { connector?: unknown }) => {
      if (request.connector !== connector || providerChainId !== RISE_TESTNET_CHAIN_ID) {
        throw new Error(`The current chain of the wallet (id: ${providerChainId}) does not match the target chain for the transaction (id: ${RISE_TESTNET_CHAIN_ID} – undefined).`);
      }
      return hash;
    },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [launchLog()] }),
  } as unknown as WagmiActions;

  const result = await createCurveballSdk({} as Config, deployment, actions).createToken({ name: "Test", symbol: "TST", uri });
  expect(switched).toEqual([{ chainId: RISE_TESTNET_CHAIN_ID, connector }]);
  expect(result.token).toBe(token);
});

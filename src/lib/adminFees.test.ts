import { expect, test } from "bun:test";
import type { Config } from "wagmi";
import { getAddress, zeroAddress, type Address, type Hash } from "viem";
import { ADMIN_ADDRESS, feePercentToBps, feeUpdateArgs, nominateFeeController, readFactoryFunds, submitFeeUpdate, type AdminActions } from "./adminFees";
import { FEE_CONTROLLER_CODE_HASH } from "./feeControllerCodeHash";

const factory = getAddress("0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056");
const treasury = getAddress("0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3");
const controller = getAddress("0x1111111111111111111111111111111111111111");
const hash = `0x${"ab".repeat(32)}` as Hash;

test("fee entry accepts exact basis points within the factory limit", () => {
  expect(feePercentToBps("0.75", 50)).toBe(75);
  expect(feePercentToBps("0", 50)).toBe(0);
  expect(() => feePercentToBps("0.755", 50)).toThrow();
  expect(() => feePercentToBps("5.01", 50)).toThrow();
  expect(() => feePercentToBps("-1", 50)).toThrow();
});

test("reads quote balances for both treasuries and the buyback vault", async () => {
  const quote = getAddress("0x4200000000000000000000000000000000000006");
  const launchTreasury = getAddress("0x2222222222222222222222222222222222222222");
  const vault = getAddress("0x3333333333333333333333333333333333333333");
  const actions = {
    readContract: async (_config: unknown, request: { address: Address; functionName: string; args?: readonly unknown[] }) => {
      if (request.address === factory) return ({ quote, vault, launchFeeTreasury: launchTreasury, treasury })[request.functionName as "quote"];
      if (request.functionName === "decimals") return 18;
      if (request.functionName === "symbol") return "WETH";
      if (request.functionName === "balanceOf") return ({ [treasury]: 0n, [launchTreasury]: 1_200_000_000_000_000n, [vault]: 17_000_000_000_000_000n })[request.args?.[0] as Address];
      throw new Error("unexpected read");
    },
  } as unknown as AdminActions;
  expect(await readFactoryFunds({} as Config, factory, 11_155_931, actions)).toMatchObject({
    symbol: "WETH", decimals: 18, tradingTreasury: { address: treasury, balance: 0n },
    launchTreasury: { address: launchTreasury, balance: 1_200_000_000_000_000n },
    buybackVault: { address: vault, balance: 17_000_000_000_000_000n },
  });
});

test("fee update preserves the latest companion settings", () => {
  expect(feeUpdateArgs(75, {
    feeBps: 50, creatorShareBps: 5000, buybackShareBps: 2500,
    creatorTaxCapBps: 50, treasury: "0x0000000000000000000000000000000000000001",
  })).toEqual([75, 5000, 2500, 50, "0x0000000000000000000000000000000000000001"]);
});

test("admin update submits only the new fee and confirms the chain value", async () => {
  let fee = 50;
  let submitted: { address: Address; functionName: string; args: readonly unknown[] } | undefined;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: async (_config: unknown, request: { functionName: string }) => ({
      feeBps: fee, creatorShareBps: 5000, buybackShareBps: 2500,
      creatorTaxCapBps: 50, treasury, owner: ADMIN_ADDRESS, pendingOwner: zeroAddress,
    })[request.functionName as "feeBps"],
    simulateContract: async (_config: unknown, request: { address: Address; functionName: string; args: readonly unknown[] }) => {
      submitted = request;
      return { request };
    },
    writeContract: async () => { fee = 75; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await submitFeeUpdate({} as Config, factory, 11_155_931, 75, undefined, actions)).toBe(hash);
  expect(submitted).toMatchObject({ address: factory, functionName: "setFeeDefaults", args: [75, 5000, 2500, 50, treasury] });
});

test("dot can edit the new factory while it owns it directly", async () => {
  let fee = 75;
  let submitted: { address: Address; functionName: string } | undefined;
  const actions = {
    getAccount: () => ({ address: treasury, chainId: 11_155_931 }),
    readContract: async (_config: unknown, request: { functionName: string }) => ({
      feeBps: fee, creatorShareBps: 5000, buybackShareBps: 2500,
      creatorTaxCapBps: 50, treasury, owner: treasury, pendingOwner: zeroAddress,
    })[request.functionName as "feeBps"],
    simulateContract: async (_config: unknown, request: { address: Address; functionName: string }) => { submitted = request; return { request }; },
    writeContract: async () => { fee = 80; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await submitFeeUpdate({} as Config, factory, 11_155_931, 80, undefined, actions)).toBe(hash);
  expect(submitted).toMatchObject({ address: factory, functionName: "setFeeDefaults" });
});

test("wallet without on-chain ownership cannot submit a fee update", async () => {
  let simulated = false;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: async (_config: unknown, request: { functionName: string }) => ({
      feeBps: 50, creatorShareBps: 5000, buybackShareBps: 2500,
      creatorTaxCapBps: 50, treasury, owner: treasury, pendingOwner: zeroAddress,
    })[request.functionName as "feeBps"],
    simulateContract: async () => { simulated = true; },
  } as unknown as AdminActions;
  await expect(submitFeeUpdate({} as Config, factory, 11_155_931, 75, undefined, actions)).rejects.toThrow("fee administrator");
  expect(simulated).toBe(false);
});

test("fee admin updates through a dot-owned controller without changing companion settings", async () => {
  let fee = 75;
  let submitted: { address: Address; functionName: string; args: readonly unknown[] } | undefined;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    getCodeHash: async () => FEE_CONTROLLER_CODE_HASH,
    readContract: async (_config: unknown, request: { address: Address; functionName: string }) => {
      if (request.address === controller) return ({ factory, owner: treasury, feeAdmin: ADMIN_ADDRESS })[request.functionName as "factory"];
      return ({ feeBps: fee, creatorShareBps: 5000, buybackShareBps: 2500,
        creatorTaxCapBps: 50, treasury, owner: controller, pendingOwner: zeroAddress })[request.functionName as "feeBps"];
    },
    simulateContract: async (_config: unknown, request: { address: Address; functionName: string; args: readonly unknown[] }) => {
      submitted = request;
      return { request };
    },
    writeContract: async () => { fee = 80; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await submitFeeUpdate({} as Config, factory, 11_155_931, 80, undefined, actions)).toBe(hash);
  expect(submitted).toMatchObject({ address: controller, functionName: "setTradingFeeBps", args: [80] });
});

test("current owner can nominate only a controller bound to this factory with dot in control", async () => {
  let pendingOwner: Address = zeroAddress;
  let submitted: { address: Address; functionName: string; args: readonly unknown[] } | undefined;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    getCodeHash: async () => FEE_CONTROLLER_CODE_HASH,
    readContract: async (_config: unknown, request: { address: Address; functionName: string }) => {
      if (request.address === controller) return ({ factory, owner: treasury, feeAdmin: ADMIN_ADDRESS })[request.functionName as "factory"];
      return ({ feeBps: 75, creatorShareBps: 5000, buybackShareBps: 2500,
        creatorTaxCapBps: 50, treasury, owner: ADMIN_ADDRESS, pendingOwner })[request.functionName as "feeBps"];
    },
    simulateContract: async (_config: unknown, request: { address: Address; functionName: string; args: readonly unknown[] }) => {
      submitted = request;
      return { request };
    },
    writeContract: async () => { pendingOwner = controller; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await nominateFeeController({} as Config, factory, 11_155_931, controller, undefined, actions)).toBe(hash);
  expect(submitted).toMatchObject({ address: factory, functionName: "transferOwnership", args: [controller] });
});

test("controller nomination rejects a contract that only spoofs the expected getters", async () => {
  let simulated = false;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    getCodeHash: async () => "0x1111111111111111111111111111111111111111111111111111111111111111",
    readContract: async (_config: unknown, request: { functionName: string }) => ({
      feeBps: 75, creatorShareBps: 5000, buybackShareBps: 2500,
      creatorTaxCapBps: 50, treasury, owner: ADMIN_ADDRESS, pendingOwner: zeroAddress,
    })[request.functionName as "feeBps"],
    simulateContract: async () => { simulated = true; },
  } as unknown as AdminActions;
  await expect(nominateFeeController({} as Config, factory, 11_155_931, controller, undefined, actions)).rejects.toThrow("bytecode");
  expect(simulated).toBe(false);
});

test("a confirmed fee update tolerates one stale RPC read", async () => {
  let sent = false;
  let postReceiptReads = 0;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: async (_config: unknown, request: { functionName: string }) => {
      if (request.functionName === "feeBps") {
        if (!sent) return 50;
        postReceiptReads += 1;
        return postReceiptReads === 1 ? 50 : 75;
      }
      return ({ creatorShareBps: 5000, buybackShareBps: 2500, creatorTaxCapBps: 50,
        treasury, owner: ADMIN_ADDRESS, pendingOwner: zeroAddress })[request.functionName as "treasury"];
    },
    simulateContract: async (_config: unknown, request: object) => ({ request }),
    writeContract: async () => { sent = true; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await submitFeeUpdate({} as Config, factory, 11_155_931, 75, undefined, actions)).toBe(hash);
  expect(postReceiptReads).toBe(2);
});

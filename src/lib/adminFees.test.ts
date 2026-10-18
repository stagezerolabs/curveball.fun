import { expect, test } from "bun:test";
import type { Config } from "wagmi";
import { getAddress, zeroAddress, type Address, type Hash } from "viem";
import { feePercentToBps, feeUpdateArgs, readFactoryFunds, submitFeeUpdate, type AdminActions } from "./adminFees";

const launchpad = getAddress("0x2222222222222222222222222222222222222222");
const treasury = getAddress("0x5555555555555555555555555555555555555555");
const guardian = getAddress("0x6666666666666666666666666666666666666666");
const ADMIN_ADDRESS = getAddress("0x1111111111111111111111111111111111111111");
const hash = `0x${"ab".repeat(32)}` as Hash;

/** The launchpad's admin reads, with fee defaults as the tuple feeDefaults() returns. */
function launchpadReads(fee: () => number, owner: Address) {
  return async (_config: unknown, request: { functionName: string }) => request.functionName === "feeDefaults"
    ? [fee(), 5_000, 2_500, 50]
    : ({ treasury, owner, pendingOwner: zeroAddress, guardian })[request.functionName as "treasury"];
}

test("fee entry accepts exact basis points up to the launchpad's 2% cap", () => {
  expect(feePercentToBps("0.75")).toBe(75);
  expect(feePercentToBps("0")).toBe(0);
  expect(feePercentToBps("2")).toBe(200);
  expect(() => feePercentToBps("0.755")).toThrow();
  expect(() => feePercentToBps("2.01")).toThrow("2%");
  expect(() => feePercentToBps("-1")).toThrow();
});

test("reads the treasury wallet, its unclaimed escrow fees, and everything the escrow holds", async () => {
  const quote = getAddress("0x4200000000000000000000000000000000000006");
  const escrow = getAddress("0x3333333333333333333333333333333333333333");
  const actions = {
    readContract: async (_config: unknown, request: { address: Address; functionName: string; args?: readonly unknown[] }) => {
      if (request.address === launchpad) return ({ quoteToken: quote, treasury, escrow })[request.functionName as "escrow"];
      if (request.address === escrow && request.functionName === "claimable") {
        expect(request.args).toEqual([treasury, quote]);
        return 400_000_000_000_000n;
      }
      if (request.functionName === "decimals") return 18;
      if (request.functionName === "symbol") return "WETH";
      if (request.functionName === "balanceOf") return ({ [treasury]: 1_200_000_000_000_000n, [escrow]: 17_000_000_000_000_000n })[request.args?.[0] as Address];
      throw new Error("unexpected read");
    },
  } as unknown as AdminActions;
  expect(await readFactoryFunds({} as Config, launchpad, 11_155_931, actions)).toMatchObject({
    symbol: "WETH", decimals: 18,
    treasuryWallet: { address: treasury, balance: 1_200_000_000_000_000n },
    treasuryInEscrow: { address: escrow, balance: 400_000_000_000_000n },
    escrowHeld: { address: escrow, balance: 17_000_000_000_000_000n },
  });
});

test("fee update resubmits the other defaults unchanged", () => {
  expect(feeUpdateArgs(75, { feeBps: 50, creatorShareBps: 5000, buybackShareBps: 2500, creatorTaxCapBps: 50 }))
    .toEqual([{ feeBps: 75, creatorShareBps: 5000, buybackShareBps: 2500, taxCapBps: 50 }]);
});

test("admin update submits only the new fee and confirms the chain value", async () => {
  let fee = 50;
  let submitted: { address: Address; functionName: string; args: readonly unknown[] } | undefined;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: launchpadReads(() => fee, ADMIN_ADDRESS),
    simulateContract: async (_config: unknown, request: { address: Address; functionName: string; args: readonly unknown[] }) => {
      submitted = request;
      return { request };
    },
    writeContract: async () => { fee = 75; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await submitFeeUpdate({} as Config, launchpad, 11_155_931, 75, undefined, actions)).toBe(hash);
  expect(submitted).toMatchObject({
    address: launchpad, functionName: "setFeeDefaults",
    args: [{ feeBps: 75, creatorShareBps: 5000, buybackShareBps: 2500, taxCapBps: 50 }],
  });
});

test("a fee above the launchpad cap is rejected before the wallet is asked", async () => {
  let simulated = false;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: launchpadReads(() => 50, ADMIN_ADDRESS),
    simulateContract: async () => { simulated = true; },
  } as unknown as AdminActions;
  await expect(submitFeeUpdate({} as Config, launchpad, 11_155_931, 201, undefined, actions)).rejects.toThrow("2%");
  expect(simulated).toBe(false);
});

test("wallet without on-chain ownership cannot submit a fee update", async () => {
  let simulated = false;
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: launchpadReads(() => 50, treasury),
    simulateContract: async () => { simulated = true; },
  } as unknown as AdminActions;
  await expect(submitFeeUpdate({} as Config, launchpad, 11_155_931, 75, undefined, actions)).rejects.toThrow("fee administrator");
  expect(simulated).toBe(false);
});

test("a confirmed fee update tolerates one stale RPC read", async () => {
  let sent = false;
  let postReceiptReads = 0;
  const fee = () => {
    if (!sent) return 50;
    postReceiptReads += 1;
    return postReceiptReads === 1 ? 50 : 75;
  };
  const actions = {
    getAccount: () => ({ address: ADMIN_ADDRESS, chainId: 11_155_931 }),
    readContract: launchpadReads(fee, ADMIN_ADDRESS),
    simulateContract: async (_config: unknown, request: object) => ({ request }),
    writeContract: async () => { sent = true; return hash; },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as AdminActions;
  expect(await submitFeeUpdate({} as Config, launchpad, 11_155_931, 75, undefined, actions)).toBe(hash);
  expect(postReceiptReads).toBe(2);
});

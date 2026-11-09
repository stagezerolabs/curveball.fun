import {
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  zeroAddress,
} from "viem";
import { createGraduationKeeper } from "../../main.mjs";

export const token = "0x0000000000000000000000000000000000000001";
const launchpad = "0x0000000000000000000000000000000000000004";
const escrow = "0x0000000000000000000000000000000000000006";
const buybackTreasury = "0x0000000000000000000000000000000000000007";
export const DAY = 86_400n;
export const TIMEOUT = 7n * DAY;
export const NOW = 1_000n * DAY;
const SUPPLY = 1_000_000n * 10n ** 18n;
const CURVE_SUPPLY = 800_000n * 10n ** 18n;
export const idleBuyback = { balance: 0n, last: 0n };

const escrowEvents = parseAbi([
  "event SwapSkipped(address indexed token,uint8 reason)",
]);

/** A launchpad and escrow on one market; `market` and `buyback` are mutable so writes can change them. */
export function harness({
  market,
  buyback = idleBuyback,
  graduationReverts = false,
  graduationError,
  buybackSkips = false,
  quoteBudget = 0n,
  curveTarget = zeroAddress,
}) {
  const writes = [];
  const marketStruct = () => ({
    creator: token,
    feeBps: 75,
    creatorShareBps: 5_000,
    buybackShareBps: 2_500,
    taxBps: 0,
    state: ["none", "trading", "ready", "graduated", "aborted"].indexOf(
      market.state,
    ),
    virtualToken: market.soldOut ? SUPPLY - CURVE_SUPPLY : SUPPLY,
    virtualQuote: 1n,
    initialVirtualQuote: 1n,
    realQuote: 0n,
    readyAt: Number(market.readyAt ?? 0n),
    pool: zeroAddress,
  });
  const reads = {
    escrow,
    buybackTreasury,
    curveToken: curveTarget,
    quoteBudget,
    GRADUATION_TIMEOUT: TIMEOUT,
    SUPPLY,
    CURVE_SUPPLY,
    STALENESS: DAY,
    owner: "0x0000000000000000000000000000000000000008",
    market: marketStruct,
    tokenBudget: () => buyback.balance,
    lastBuyback: () => buyback.last,
  };
  const publicClient = {
    getBlockNumber: async () => 12n,
    getContractEvents: async () => [{ args: { token } }],
    readContract: async ({ functionName }) => {
      const value = reads[functionName];
      if (value === undefined)
        throw new Error(`Unexpected read ${functionName}`);
      return typeof value === "function" ? value() : value;
    },
    getTransactionCount: async () => 0,
    simulateContract: async ({ functionName }) => {
      if (functionName === "graduate" && graduationError) throw graduationError;
      if (functionName === "graduate" && graduationReverts)
        throw new ContractFunctionRevertedError({
          abi: parseAbi(["function graduate(address token)"]),
          functionName: "graduate",
          message: "graduate reverts",
        });
      return { request: { functionName } };
    },
    waitForTransactionReceipt: async () => ({
      status: "success",
      logs:
        writes.at(-1) === "convert" && buybackSkips
          ? [
              {
                address: buybackTreasury,
                topics: encodeEventTopics({
                  abi: escrowEvents,
                  eventName: "SwapSkipped",
                  args: { token },
                }),
                data: encodeAbiParameters([{ type: "uint8" }], [3]),
              },
            ]
          : [],
    }),
  };
  const walletClient = {
    account: { address: "0x0000000000000000000000000000000000000005" },
    writeContract: async ({ functionName }) => {
      writes.push(functionName);
      if (functionName === "graduate") market.state = "graduated";
      if (functionName === "abortGraduation") market.state = "aborted";
      if (functionName === "convert" && !buybackSkips) buyback.balance = 0n;
      if (functionName === "buyback" && !buybackSkips) buyback.last = NOW;
      return "0x01";
    },
  };
  const logs = [];
  let clock = Number(NOW) * 1_000;
  const keeper = createGraduationKeeper({
    publicClient,
    walletClient,
    launchpad,
    deploymentBlock: 10n,
    now: () => clock,
    logger: {
      info() {},
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
  });
  return {
    keeper,
    writes,
    logs,
    advance: (ms) => {
      clock += ms;
    },
  };
}

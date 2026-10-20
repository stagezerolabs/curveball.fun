// Reproducer: a transient RPC failure during keeper simulation is indistinguishable
// from "graduation reverts", so past the timeout the keeper ABORTS a graduation that
// would actually have succeeded.
//
// Drop into keeper/ and run: node --test abort-on-rpc-error.test.mjs
// (or point the import at the keeper file's absolute path — see import below)

import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from "viem";
import { createGraduationKeeper } from "curveball-keeper"; // <-- path to graduation-keeper.mjs

const SUPPLY = 1_000_000n * 10n ** 18n;
const CURVE_SUPPLY = 800_000n * 10n ** 18n;
const TIMEOUT = 7n * 24n * 3600n;
const NOW = 2_000_000n;
const launchpad = "0x00000000000000000000000000000000000000aa";
const escrow = "0x00000000000000000000000000000000000000bb";
const token = "0x00000000000000000000000000000000000000cc";

const escrowEvents = parseAbi(["event BuybackSkipped(address indexed token,uint8 reason)"]);

/**
 * Harness identical in shape to the real test harness, except `simulateContract`
 * rejects with a *transport error* rather than a revert. This is what a dropped
 * connection, a 429 from the RPC provider, or an oversized response looks like.
 */
function harness({ simulateError }) {
  const writes = [];
  const market = { state: "ready", soldOut: true, readyAt: NOW - TIMEOUT };
  const marketStruct = () => ({
    creator: token, feeBps: 75, creatorShareBps: 5_000, buybackShareBps: 2_500, taxBps: 0,
    state: ["none", "trading", "ready", "graduated", "aborted"].indexOf(market.state),
    virtualToken: SUPPLY - CURVE_SUPPLY, virtualQuote: 1n, initialVirtualQuote: 1n,
    realQuote: 0n, reserveTokens: 0n, readyAt: Number(market.readyAt), pool: zeroAddress,
  });
  const reads = {
    escrow, GRADUATION_TIMEOUT: TIMEOUT, SUPPLY, CURVE_SUPPLY, BUYBACK_INTERVAL: 3_600n,
    market: marketStruct, buybackBalance: () => 0n, lastBuyback: () => 0n,
  };
  const publicClient = {
    getBlockNumber: async () => 12n,
    getContractEvents: async () => [{ args: { token } }],
    readContract: async ({ functionName }) => {
      const value = reads[functionName];
      if (value === undefined) throw new Error(`Unexpected read ${functionName}`);
      return typeof value === "function" ? value() : value;
    },
    getTransactionCount: async () => 0,
    simulateContract: async () => { throw simulateError; },
    waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
  };
  const walletClient = {
    account: { address: "0x0000000000000000000000000000000000000005" },
    writeContract: async ({ functionName }) => {
      writes.push(functionName);
      if (functionName === "abortGraduation") market.state = "aborted";
      return "0x01";
    },
  };
  const keeper = createGraduationKeeper({
    publicClient, walletClient, launchpad, deploymentBlock: 10n, now: () => Number(NOW) * 1_000,
    logger: { info() {}, warn() {}, error() {} },
  });
  return { keeper, writes, market };
}

test("FINDING: a transient RPC error makes the keeper ABORT a healthy sold-out market", async () => {
  // A plain network error — NOT a revert. SOLIDITY revert data would be a
  // ContractFunctionExecutionError with a decoded reason.
  const rpcBlip = Object.assign(new Error("fetch failed"), {
    name: "HttpRequestError",
    status: 429,
  });

  const { keeper, writes, market } = harness({ simulateError: rpcBlip });
  await keeper.tick();

  // The keeper never checks the error kind, so `graduationReverts` becomes true, and
  // because readyAt + TIMEOUT <= now it declares the graduation stuck and aborts it.
  assert.deepEqual(
    writes,
    ["abortGraduation"],
    "expected the keeper to abort — this is the bug",
  );
  assert.equal(market.state, "aborted", "market was pushed into the sticky Aborted state");
});

test("control: an actual revert past the timeout SHOULD abort", async () => {
  const realRevert = Object.assign(new Error("execution reverted"), {
    name: "ContractFunctionExecutionError",
    shortMessage: "execution reverted",
  });
  const { keeper, writes, market } = harness({ simulateError: realRevert });
  await keeper.tick();
  assert.deepEqual(writes, ["abortGraduation"]);
  assert.equal(market.state, "aborted");
});

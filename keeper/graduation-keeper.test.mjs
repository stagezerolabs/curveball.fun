import { test } from "node:test";
import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import { createGraduationKeeper, processMarket } from "./graduation-keeper.mjs";

const token = "0x0000000000000000000000000000000000000001";
const curve = "0x0000000000000000000000000000000000000002";
const pool = "0x0000000000000000000000000000000000000003";
const factory = "0x0000000000000000000000000000000000000004";

test("keeper prepares and creates a pool after the curve sells out", async () => {
  const state = { sold: 100n, ready: false, graduated: false, pool: zeroAddress };
  const calls = [];
  const result = await processMarket({
    token, curveSupply: 100n,
    readState: async () => ({ ...state }),
    send: async (functionName) => {
      calls.push(functionName);
      if (functionName === "graduate") state.ready = true;
      else { state.graduated = true; state.pool = pool; }
      return true;
    },
  });
  assert.deepEqual(calls, ["graduate", "createGraduatedPool"]);
  assert.deepEqual(result, { status: "graduated", pool });
});

test("keeper waits when venue preparation is deferred", async () => {
  const calls = [];
  const result = await processMarket({
    token, curveSupply: 100n,
    readState: async () => ({ sold: 100n, ready: false, graduated: false, pool: zeroAddress }),
    send: async (functionName) => { calls.push(functionName); return true; },
  });
  assert.deepEqual(result, { status: "deferred" });
  assert.deepEqual(calls, ["graduate"]);
});

test("keeper does not spend gas when the venue preflight fails", async () => {
  const calls = [];
  const result = await processMarket({
    token, curveSupply: 100n,
    readState: async () => ({ sold: 100n, ready: false, graduated: false, pool: zeroAddress }),
    canPrepare: async () => false,
    send: async (functionName) => { calls.push(functionName); return true; },
  });
  assert.deepEqual(result, { status: "deferred" });
  assert.deepEqual(calls, []);
});

test("keeper rechecks the curve before creating a pool", async () => {
  let reads = 0;
  const calls = [];
  const result = await processMarket({
    token, curveSupply: 100n,
    readState: async () => {
      reads += 1;
      return { sold: reads < 2 ? 100n : 99n, ready: true, graduated: false, pool: zeroAddress };
    },
    send: async (functionName) => { calls.push(functionName); return true; },
  });
  assert.deepEqual(result, { status: "bonding" });
  assert.deepEqual(calls, []);
});

test("a sweep discovers launches and processes each completed market once", async () => {
  const state = { sold: 100n, ready: false, graduated: false, pool: zeroAddress };
  const writes = [];
  const publicClient = {
    getBlockNumber: async () => 12n,
    getContractEvents: async () => [{ args: { token, curve } }],
    readContract: async ({ functionName }) => {
      if (functionName === "curveSupply") return 100n;
      if (functionName === "venueOf") return factory;
      if (functionName === "supply") return 1_000n;
      if (functionName === "reserveAmount") return 0n;
      if (functionName === "realQuote") return 10n;
      if (functionName === "check") return undefined;
      return state[functionName];
    },
    getTransactionCount: async () => 0,
    simulateContract: async ({ functionName }) => ({ request: { functionName } }),
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const walletClient = {
    account: { address: "0x0000000000000000000000000000000000000005" },
    writeContract: async ({ functionName }) => {
      writes.push(functionName);
      if (functionName === "graduate") state.ready = true;
      else { state.graduated = true; state.pool = pool; }
      return "0x01";
    },
  };
  const keeper = createGraduationKeeper({ publicClient, walletClient, factory, deploymentBlock: 10n, logger: { info() {}, warn() {}, error() {} } });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["graduate", "createGraduatedPool"]);
});

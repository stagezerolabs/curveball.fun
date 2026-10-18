import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from "viem";
import { createGraduationKeeper, decide } from "./graduation-keeper.mjs";

const token = "0x0000000000000000000000000000000000000001";
const launchpad = "0x0000000000000000000000000000000000000004";
const escrow = "0x0000000000000000000000000000000000000006";
const DAY = 86_400n;
const TIMEOUT = 7n * DAY;
const NOW = 1_000n * DAY;
const SUPPLY = 1_000_000n * 10n ** 18n;
const CURVE_SUPPLY = 800_000n * 10n ** 18n;
const idleBuyback = { balance: 0n, last: 0n, interval: 3_600n };

test("decision table", () => {
  const cases = [
    ["trading", { state: "trading", soldOut: false }, "wait"],
    ["ready", { state: "ready", soldOut: true, readyAt: NOW - 60n }, "graduate"],
    ["ready while Icarus is paused (graduation still simulates)", { state: "ready", soldOut: true, readyAt: NOW - 60n }, "graduate"],
    ["ready, graduation reverts, before the timeout", { state: "ready", soldOut: true, readyAt: NOW - TIMEOUT + 1n, graduationReverts: true }, "wait"],
    ["ready, graduation reverts, past the timeout", { state: "ready", soldOut: true, readyAt: NOW - TIMEOUT, graduationReverts: true }, "abort"],
    ["aborted below sellout", { state: "aborted", soldOut: false }, "wait"],
    ["aborted and sold out again", { state: "aborted", soldOut: true }, "graduate"],
    ["graduated with nothing to buy", { state: "graduated", buyback: idleBuyback }, "wait"],
    ["graduated, first buyback", { state: "graduated", buyback: { ...idleBuyback, balance: 5n } }, "buyback"],
    ["graduated, inside the interval", { state: "graduated", buyback: { ...idleBuyback, balance: 5n, last: NOW - 3_599n } }, "wait"],
    ["graduated, interval elapsed", { state: "graduated", buyback: { ...idleBuyback, balance: 5n, last: NOW - 3_600n } }, "buyback"],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(decide({ readyAt: 0n, nowSeconds: NOW, timeout: TIMEOUT, ...input }), expected, name);
  }
});

const escrowEvents = parseAbi(["event BuybackSkipped(address indexed token,uint8 reason)"]);

/** A launchpad and escrow on one market; `market` and `buyback` are mutable so writes can change them. */
function harness({ market, buyback = idleBuyback, graduationReverts = false, buybackSkips = false }) {
  const writes = [];
  const marketStruct = () => ({
    creator: token, feeBps: 75, creatorShareBps: 5_000, buybackShareBps: 2_500, taxBps: 0,
    state: ["none", "trading", "ready", "graduated", "aborted"].indexOf(market.state),
    virtualToken: market.soldOut ? SUPPLY - CURVE_SUPPLY : SUPPLY, virtualQuote: 1n, initialVirtualQuote: 1n,
    realQuote: 0n, reserveTokens: 0n, readyAt: Number(market.readyAt ?? 0n), pool: zeroAddress,
  });
  const reads = {
    escrow, GRADUATION_TIMEOUT: TIMEOUT, SUPPLY, CURVE_SUPPLY, BUYBACK_INTERVAL: 3_600n,
    market: marketStruct, buybackBalance: () => buyback.balance, lastBuyback: () => buyback.last,
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
    simulateContract: async ({ functionName }) => {
      if (functionName === "graduate" && graduationReverts) throw new Error("graduate reverts");
      return { request: { functionName } };
    },
    waitForTransactionReceipt: async () => ({
      status: "success",
      logs: writes.at(-1) === "buyback" && buybackSkips ? [{
        address: escrow,
        topics: encodeEventTopics({ abi: escrowEvents, eventName: "BuybackSkipped", args: { token } }),
        data: encodeAbiParameters([{ type: "uint8" }], [3]),
      }] : [],
    }),
  };
  const walletClient = {
    account: { address: "0x0000000000000000000000000000000000000005" },
    writeContract: async ({ functionName }) => {
      writes.push(functionName);
      if (functionName === "graduate") market.state = "graduated";
      if (functionName === "abortGraduation") market.state = "aborted";
      if (functionName === "buyback" && !buybackSkips) buyback.last = NOW;
      return "0x01";
    },
  };
  const logs = [];
  let clock = Number(NOW) * 1_000;
  const keeper = createGraduationKeeper({
    publicClient, walletClient, launchpad, deploymentBlock: 10n, now: () => clock,
    logger: { info() {}, warn: (message) => logs.push(message), error: (message) => logs.push(message) },
  });
  return { keeper, writes, logs, advance: (ms) => { clock += ms; } };
}

test("a sweep graduates a sold-out market once and then watches it for buybacks", async () => {
  const { keeper, writes } = harness({ market: { state: "ready", soldOut: true, readyAt: NOW - 60n } });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["graduate"]);
});

test("a stuck graduation past the timeout is aborted instead", async () => {
  const { keeper, writes } = harness({ market: { state: "ready", soldOut: true, readyAt: NOW - TIMEOUT }, graduationReverts: true });
  await keeper.tick();
  assert.deepEqual(writes, ["abortGraduation"]);
});

test("a skipped buyback backs off instead of retrying every sweep", async () => {
  const { keeper, writes, logs, advance } = harness({
    market: { state: "graduated", soldOut: true }, buyback: { ...idleBuyback, balance: 5n }, buybackSkips: true,
  });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["buyback"]);
  assert.match(logs[0], /Buyback skipped \(price outside the band\)/);
  advance(3_600_000);
  await keeper.tick();
  assert.deepEqual(writes, ["buyback", "buyback"]);
});

test("a completed buyback waits out the interval", async () => {
  const { keeper, writes } = harness({ market: { state: "graduated", soldOut: true }, buyback: { ...idleBuyback, balance: 5n } });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["buyback"]);
});

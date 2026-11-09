import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransactionSender } from "../../src/runtime/transactions.mjs";

const account = { address: "0x0000000000000000000000000000000000000005" };
const launchpad = "0x0000000000000000000000000000000000000004";
const token = "0x0000000000000000000000000000000000000001";

test("a pending wallet nonce prevents a duplicate transaction", async () => {
  const tags = [];
  const sender = createTransactionSender({
    publicClient: {
      getTransactionCount: async ({ blockTag }) => {
        tags.push(blockTag);
        return blockTag === "pending" ? 2 : 1;
      },
      simulateContract: async () => {
        throw new Error("should not simulate");
      },
    },
    walletClient: { account },
    logger: { info() {} },
  });

  assert.equal(await sender("graduate", launchpad, [], token), null);
  assert.deepEqual(tags, ["latest", "pending"]);
});

test("a mined transaction returns its receipt", async () => {
  const calls = [];
  const receipt = { status: "success", logs: [] };
  const sender = createTransactionSender({
    publicClient: {
      getTransactionCount: async () => 1,
      simulateContract: async (request) => {
        calls.push(request);
        return { request };
      },
      waitForTransactionReceipt: async ({ hash }) => {
        assert.equal(hash, "0x01");
        return receipt;
      },
    },
    walletClient: {
      account,
      writeContract: async (request) => {
        calls.push(request);
        return "0x01";
      },
    },
    logger: { info() {} },
  });

  assert.equal(await sender("graduate", launchpad, [], token), receipt);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [token]);
});

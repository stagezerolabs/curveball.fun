import { test } from "node:test";
import assert from "node:assert/strict";
import { readMarketStatus } from "../../src/features/markets/status.mjs";

const launchpad = "0x0000000000000000000000000000000000000004";
const treasury = "0x0000000000000000000000000000000000000007";
const token = "0x0000000000000000000000000000000000000001";

test("graduated status includes the treasury's market-token credit", async () => {
  const calls = [];
  const publicClient = {
    readContract: async ({ address, functionName, args }) => {
      calls.push([address, functionName, args]);
      if (functionName === "market")
        return { state: 3, virtualToken: 20n, readyAt: 15 };
      if (functionName === "tokenBudget") return 5n;
      throw new Error(`Unexpected read ${functionName}`);
    },
  };
  const status = await readMarketStatus({
    publicClient,
    launchpad,
    constants: {
      terminalVirtualToken: 20n,
      buybackTreasury: treasury,
    },
    token,
  });

  assert.deepEqual(status, {
    state: "graduated",
    soldOut: true,
    readyAt: 15n,
    buyback: { balance: 5n },
  });
  assert.deepEqual(calls, [
    [launchpad, "market", [token]],
    [treasury, "tokenBudget", [token]],
  ]);
});

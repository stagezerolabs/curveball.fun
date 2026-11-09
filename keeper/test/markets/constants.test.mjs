import { test } from "node:test";
import assert from "node:assert/strict";
import { readKeeperConstants } from "../../src/features/markets/constants.mjs";

test("an incompatible escrow fails the keeper's initial configuration read", async () => {
  const publicClient = {
    readContract: async ({ functionName }) => {
      if (functionName === "escrow")
        return "0x0000000000000000000000000000000000000006";
      if (functionName === "GRADUATION_TIMEOUT") return 1n;
      if (functionName === "SUPPLY") return 100n;
      if (functionName === "CURVE_SUPPLY") return 80n;
      if (functionName === "buybackTreasury")
        throw new Error("buybackTreasury unavailable");
      throw new Error(`Unexpected read ${functionName}`);
    },
  };

  await assert.rejects(
    readKeeperConstants({
      publicClient,
      launchpad: "0x0000000000000000000000000000000000000004",
    }),
    /buybackTreasury unavailable/,
  );
});

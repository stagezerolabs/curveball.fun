import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, NOW } from "./support/keeper-harness.mjs";

test("a sweep graduates a sold-out market once and then watches it for buybacks", async () => {
  const { keeper, writes } = harness({
    market: { state: "ready", soldOut: true, readyAt: NOW - 60n },
  });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["graduate"]);
});

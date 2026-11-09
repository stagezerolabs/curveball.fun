import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, NOW, TIMEOUT } from "../support/keeper-harness.mjs";

test("a stuck graduation past the timeout is aborted instead", async () => {
  const { keeper, writes } = harness({
    market: { state: "ready", soldOut: true, readyAt: NOW - TIMEOUT },
    graduationReverts: true,
  });
  await keeper.tick();
  assert.deepEqual(writes, ["abortGraduation"]);
});

test("a transient RPC failure never aborts a healthy ready market", async () => {
  const { keeper, writes, logs } = harness({
    market: { state: "ready", soldOut: true, readyAt: NOW - TIMEOUT },
    graduationError: new Error("HTTP 429 from RPC"),
  });
  await keeper.tick();
  assert.deepEqual(writes, []);
  assert.match(logs.join("\n"), /HTTP 429 from RPC/);
});

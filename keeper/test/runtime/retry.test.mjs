import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetryPolicy } from "../../src/runtime/retry.mjs";

test("failed actions back off exponentially and success resets the delay", () => {
  let clock = 1_000;
  const warnings = [];
  const retry = createRetryPolicy({
    now: () => clock,
    logger: { warn: (message) => warnings.push(message) },
  });

  retry.backOff("market", "token", "failed", 60_000);
  assert.equal(retry.canAttempt("market", 60_999), false);
  assert.equal(retry.canAttempt("market", 61_000), true);
  clock = 61_000;
  retry.backOff("market", "token", "failed", 60_000);
  assert.equal(retry.canAttempt("market", 180_999), false);
  assert.equal(retry.canAttempt("market", 181_000), true);
  assert.match(warnings.at(-1), /120 seconds/);

  retry.clearBackOff("market");
  assert.equal(retry.canAttempt("market"), true);
  retry.backOff("market", "token", "failed", 60_000);
  assert.match(warnings.at(-1), /60 seconds/);
});

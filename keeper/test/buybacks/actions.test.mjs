import { test } from "node:test";
import assert from "node:assert/strict";
import {
  harness,
  DAY,
  NOW,
  idleBuyback,
  token,
} from "../support/keeper-harness.mjs";

test("a skipped conversion backs off instead of retrying every sweep", async () => {
  const { keeper, writes, logs, advance } = harness({
    market: { state: "graduated", soldOut: true },
    buyback: { ...idleBuyback, balance: 5n },
    buybackSkips: true,
  });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["convert"]);
  assert.match(logs[0], /Buyback skipped \(price outside the band\)/);
  advance(3_600_000);
  await keeper.tick();
  assert.deepEqual(writes, ["convert", "convert"]);
});

test("a completed conversion empties the market credit", async () => {
  const { keeper, writes } = harness({
    market: { state: "graduated", soldOut: true },
    buyback: { ...idleBuyback, balance: 5n },
  });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["convert"]);
});

test("a shared CURVE buyback runs once when stale", async () => {
  const { keeper, writes, advance } = harness({
    market: { state: "graduated", soldOut: true },
    buyback: { ...idleBuyback, last: NOW - DAY + 1n },
    quoteBudget: 5n,
    curveTarget: token,
  });
  await keeper.tick();
  assert.deepEqual(writes, []);
  advance(1_000);
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(writes, ["buyback"]);
});

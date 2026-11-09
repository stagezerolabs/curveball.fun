import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../../src/features/graduation/decision.mjs";

const DAY = 86_400n;
const TIMEOUT = 7n * DAY;
const NOW = 1_000n * DAY;
const idleBuyback = { balance: 0n };

test("decision table", () => {
  const cases = [
    ["trading", { state: "trading", soldOut: false }, "wait"],
    [
      "ready",
      { state: "ready", soldOut: true, readyAt: NOW - 60n },
      "graduate",
    ],
    [
      "ready while Icarus is paused (graduation still simulates)",
      { state: "ready", soldOut: true, readyAt: NOW - 60n },
      "graduate",
    ],
    [
      "ready, graduation reverts, before the timeout",
      {
        state: "ready",
        soldOut: true,
        readyAt: NOW - TIMEOUT + 1n,
        graduationReverts: true,
      },
      "wait",
    ],
    [
      "ready, graduation reverts, past the timeout",
      {
        state: "ready",
        soldOut: true,
        readyAt: NOW - TIMEOUT,
        graduationReverts: true,
      },
      "abort",
    ],
    ["aborted below sellout", { state: "aborted", soldOut: false }, "wait"],
    [
      "aborted and sold out again",
      { state: "aborted", soldOut: true },
      "graduate",
    ],
    [
      "graduated with nothing to buy",
      { state: "graduated", buyback: idleBuyback },
      "wait",
    ],
    [
      "graduated, first buyback",
      { state: "graduated", buyback: { ...idleBuyback, balance: 5n } },
      "convert",
    ],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(
      decide({ readyAt: 0n, nowSeconds: NOW, timeout: TIMEOUT, ...input }),
      expected,
      name,
    );
  }
});

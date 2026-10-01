import { expect, test } from "bun:test";
import { advanceGraduationMessage } from "./advanceGraduation";

test("a deferred preparation is reported as deferred to the market UI", async () => {
  const token = { address: "0x1111111111111111111111111111111111111111", pending: false };
  const sdk = {
    graduate: async () => ({ deferred: true }),
    createGraduatedPool: async () => { throw Error("pool creation should not run"); },
  };
  expect(await advanceGraduationMessage(sdk, token)).toContain("deferred");
});

test("a prepared market reports readiness and a pending market creates its pool", async () => {
  const calls = [];
  const sdk = {
    graduate: async () => { calls.push("prepare"); return { deferred: false }; },
    createGraduatedPool: async () => { calls.push("pool"); return {}; },
  };
  const address = "0x1111111111111111111111111111111111111111";
  expect(await advanceGraduationMessage(sdk, { address, pending: false })).toContain("prepared");
  expect(await advanceGraduationMessage(sdk, { address, pending: true })).toContain("pool created");
  expect(calls).toEqual(["prepare", "pool"]);
});

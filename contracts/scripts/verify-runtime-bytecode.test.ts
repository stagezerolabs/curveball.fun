import { expect, test } from "bun:test";
import { matchesCompiledRuntime } from "./verify-runtime-bytecode";

const artifact = {
  deployedBytecode: {
    object: "0x600100026003",
    immutableReferences: { owner: [{ start: 2, length: 2 }] },
  },
};

test("matches the complete runtime while allowing declared immutable values", () => {
  expect(matchesCompiledRuntime("0x6001ffff6003", artifact)).toBe(true);
  expect(matchesCompiledRuntime("0x6002ffff6003", artifact)).toBe(false);
  expect(matchesCompiledRuntime("0x6001ffff6004", artifact)).toBe(false);
  expect(matchesCompiledRuntime("0x6001ffff", artifact)).toBe(false);
});

test("rejects an immutable reference outside the runtime", () => {
  expect(
    matchesCompiledRuntime("0x6001ffff6003", {
      deployedBytecode: {
        ...artifact.deployedBytecode,
        immutableReferences: { owner: [{ start: 5, length: 2 }] },
      },
    }),
  ).toBe(false);
});

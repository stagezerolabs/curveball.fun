import assert from "node:assert/strict";
import { test } from "node:test";
import { readKeeperPrivateKey } from "../main.mjs";

const key = `0x${"a".repeat(64)}`;

test("keeper reads its key from the mounted secret file", () => {
  const result = readKeeperPrivateKey({
    env: { KEEPER_PRIVATE_KEY_FILE: "/run/secrets/keeper_private_key" },
    readFile(path, encoding) {
      assert.equal(path, "/run/secrets/keeper_private_key");
      assert.equal(encoding, "utf8");
      return `${key}\n`;
    },
  });
  assert.equal(result, key);
});

test("keeper rejects competing or missing key sources", () => {
  assert.throws(
    () =>
      readKeeperPrivateKey({
        env: {
          KEEPER_PRIVATE_KEY: key,
          KEEPER_PRIVATE_KEY_FILE: "/run/secrets/keeper_private_key",
        },
      }),
    /only one keeper private key source/,
  );
  assert.throws(() => readKeeperPrivateKey({ env: {} }), /required/);
  assert.throws(
    () =>
      readKeeperPrivateKey({
        env: { KEEPER_PRIVATE_KEY_FILE: "/run/secrets/keeper_private_key" },
        readFile: () => "\n",
      }),
    /empty/,
  );
});

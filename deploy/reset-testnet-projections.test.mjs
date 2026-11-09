import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const makefile = resolve(import.meta.dirname, "../Makefile");
const sql = resolve(import.meta.dirname, "reset-local-testnet-projections.sql");
const launchpad = "0x1111111111111111111111111111111111111111";

function fixture(record) {
  const root = mkdtempSync(join(tmpdir(), "curveball-make-reset-"));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, "deployments/11155931"), { recursive: true });
  mkdirSync(join(root, "deploy"));
  writeFileSync(
    join(root, "deployments/11155931/curveball.json"),
    JSON.stringify(record),
  );
  writeFileSync(
    join(root, "deploy/reset-local-testnet-projections.sql"),
    readFileSync(sql),
  );
  const compose = join(root, "fake-compose.sh");
  writeFileSync(
    compose,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_COMPOSE_LOG"
if [ "$1" = ps ]; then
  printf 'api\\nkeeper\\npostgres\\n'
fi
if [ "$1" = exec ] && [ "$FAKE_PSQL_FAIL" = 1 ]; then
  exit 7
fi
`,
    { mode: 0o755 },
  );
  const log = join(root, "compose.log");
  return {
    root,
    run(extra = {}) {
      const args = [
        "-f",
        makefile,
        "reset-testnet-projections",
        `COMPOSE=${compose}`,
      ];
      if (extra.leaveStopped) args.push("RESET_LEAVE_STOPPED=1");
      const result = spawnSync("make", args, {
        cwd: root,
        env: {
          ...process.env,
          FAKE_COMPOSE_LOG: log,
          FAKE_PSQL_FAIL: extra.failSql ? "1" : "0",
        },
        encoding: "utf8",
      });
      const calls = existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
        : [];
      return { result, calls };
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("invalid testnet record never stops a service", () => {
  for (const record of [
    { chainId: 11155931, launchpad: "" },
    { chainId: 4153, launchpad },
  ]) {
    const context = fixture(record);
    try {
      const { result, calls } = context.run();
      assert.notEqual(result.status, 0);
      assert.deepEqual(calls, []);
    } finally {
      context.close();
    }
  }
});

test("failed SQL restores previously running services", () => {
  const context = fixture({ chainId: 11155931, launchpad });
  try {
    const { result, calls } = context.run({ failSql: true });
    assert.notEqual(result.status, 0);
    assert.ok(calls.includes("stop api keeper"));
    assert.ok(calls.some((call) => call.startsWith("exec -T postgres psql ")));
    assert.equal(
      calls.at(-1),
      "up -d api keeper postgres",
    );
  } finally {
    context.close();
  }
});

test("successful standalone reset restores services; activation can leave them stopped", () => {
  for (const leaveStopped of [false, true]) {
    const context = fixture({ chainId: 11155931, launchpad });
    try {
      const { result, calls } = context.run({ leaveStopped });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        calls.includes("up -d api keeper postgres"),
        !leaveStopped,
      );
    } finally {
      context.close();
    }
  }
});

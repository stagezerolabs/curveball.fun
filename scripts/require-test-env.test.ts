import { describe, expect, test } from "bun:test";

const script = new URL("./require-test-env.ts", import.meta.url).pathname;

describe("required integration-test environment", () => {
  test("fails before running the command when a required value is missing", () => {
    const result = Bun.spawnSync(
      ["bun", script, "CURVEBALL_MISSING_TEST_VALUE", "--", "bun", "-e", "process.exit(0)"],
      { env: { ...Bun.env, CURVEBALL_MISSING_TEST_VALUE: "" } },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("CURVEBALL_MISSING_TEST_VALUE");
  });

  test("runs the command when all required values exist", () => {
    const result = Bun.spawnSync(
      ["bun", script, "CURVEBALL_PRESENT_TEST_VALUE", "--", "bun", "-e", "console.log('ran')"],
      { env: { ...Bun.env, CURVEBALL_PRESENT_TEST_VALUE: "yes" } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("ran");
  });
});

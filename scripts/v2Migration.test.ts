import { describe, expect, test } from "bun:test";
import { assertDirectTarget, assertMigrationHistory, executeV2Migration, parseMigrationMode, type MigrationOperations } from "./v2MigrationGuards";

const prior = [
  "6215acf4b024360d40546c48ff74235136461fc0445ba1612ca3126d6fbf673e",
  "79826d8de288c15bdeedda177de88dac4004a856b55eae5aefd73c87bebcab44",
  "c30041c677df88991a1852b374419f5381017fd033a8ae5ebfbc1db4859407b8",
];

describe("V2 database migration guard", () => {
  test("rejects mistyped or extra preflight arguments", () => {
    expect(parseMigrationMode([])).toBe(false);
    expect(parseMigrationMode(["--preflight"])).toBe(true);
    expect(() => parseMigrationMode(["--prefligth"])).toThrow();
    expect(() => parseMigrationMode(["--preflight", "--extra"])).toThrow();
  });

  test("requires the pinned direct Neon endpoint, database, and role", () => {
    const host = "ep-abc.us-east-2.aws.neon.tech";
    const direct = `postgresql://user:secret@${host}/neondb?sslmode=require`;
    expect(() => assertDirectTarget(direct, host, "neondb", "user")).not.toThrow();
    expect(() => assertDirectTarget(direct, "ep-other.us-east-2.aws.neon.tech", "neondb", "user")).toThrow();
    expect(() => assertDirectTarget(direct, host, "another", "user")).toThrow();
    expect(() => assertDirectTarget(direct, host, "neondb", "other")).toThrow();
    expect(() =>
      assertDirectTarget(`postgresql://user:secret@ep-abc-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`, host, "neondb", "user"),
    ).toThrow();
  });

  test("accepts only the three known prior migrations before migration", () => {
    expect(() => assertMigrationHistory(prior, prior, "pending")).not.toThrow();
    expect(() => assertMigrationHistory(prior.slice(0, 2), prior, "pending")).toThrow();
    expect(() => assertMigrationHistory([...prior, "unexpected"], prior, "pending")).toThrow();
  });

  test("requires exactly the expected fourth migration after migration", () => {
    expect(() => assertMigrationHistory([...prior, "v2"], [...prior, "v2"], "applied")).not.toThrow();
    expect(() => assertMigrationHistory(prior, [...prior, "v2"], "applied")).toThrow();
    expect(() => assertMigrationHistory([...prior, "other"], [...prior, "v2"], "applied")).toThrow();
  });

  function operations(trace: string[], failAt?: string): MigrationOperations {
    const step = async (name: string) => {
      trace.push(name);
      if (name === failAt) throw new Error(name);
    };
    return {
      assertBranchesAbsent: () => step("branches"),
      inspectProductionPending: () => step("pending"),
      createRehearsal: () => step("create-rehearsal"),
      rehearse: () => step("rehearse"),
      createBackup: () => step("create-backup"),
      migrateProduction: () => step("migrate-production"),
      verifyProduction: () => step("verify-production"),
    };
  }

  test("preflight stops before branch creation or migration", async () => {
    const trace: string[] = [];
    await executeV2Migration(operations(trace), true);
    expect(trace).toEqual(["branches", "pending"]);
  });

  test("rehearsal failure prevents backup and production migration", async () => {
    const trace: string[] = [];
    await expect(executeV2Migration(operations(trace, "rehearse"), false)).rejects.toThrow();
    expect(trace).toEqual(["branches", "pending", "create-rehearsal", "rehearse"]);
  });

  test("checks the parent again, creates backup, then migrates production", async () => {
    const trace: string[] = [];
    await executeV2Migration(operations(trace), false);
    expect(trace).toEqual([
      "branches", "pending", "create-rehearsal", "rehearse", "pending", "create-backup", "pending", "migrate-production", "verify-production",
    ]);
  });

  test("an existing branch aborts before a database mutation", async () => {
    const trace: string[] = [];
    await expect(executeV2Migration(operations(trace, "branches"), false)).rejects.toThrow();
    expect(trace).toEqual(["branches"]);
  });
});

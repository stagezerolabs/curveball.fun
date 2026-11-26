import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";

import { leaderboardSnapshots } from "../src/schema.ts";

const drizzleDir = join(import.meta.dir, "../drizzle");

function migrationAdding(column) {
  const files = readdirSync(drizzleDir).filter((name) => name.endsWith(".sql"));
  return files
    .map((name) => ({ name, sql: readFileSync(join(drizzleDir, name), "utf8") }))
    .find(({ sql }) =>
      sql.includes(`"leaderboard_snapshots" ADD COLUMN "${column}"`),
    );
}

describe("leaderboard_snapshots v3 columns", () => {
  test("schema has status, as_of_time and details with safe defaults", () => {
    const { columns, checks } = getTableConfig(leaderboardSnapshots);
    const byName = new Map(columns.map((column) => [column.name, column]));
    expect(byName.get("status")?.notNull).toBe(true);
    expect(byName.get("status")?.default).toBe("ranked");
    expect(byName.has("as_of_time")).toBe(true);
    expect(byName.get("details")?.notNull).toBe(true);
    expect(checks.map((check) => check.name)).toContain(
      "leaderboard_snapshots_status_check",
    );
  });

  test("the migration is additive only", () => {
    const migration = migrationAdding("status");
    expect(migration).toBeDefined();
    expect(migration.sql).toContain('ADD COLUMN "as_of_time"');
    expect(migration.sql).toContain('ADD COLUMN "details"');
    expect(migration.sql).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN|UPDATE /i);
  });
});

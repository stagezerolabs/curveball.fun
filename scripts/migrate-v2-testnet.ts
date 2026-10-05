import { createHash } from "node:crypto";
import postgres from "postgres";
import { assertDirectTarget, assertMigrationHistory, executeV2Migration, parseMigrationMode } from "./v2MigrationGuards";

const projectId = "dry-dew-99165555";
const parentName = "main";
const parentId = "br-odd-lab-b5i5x8zo";
const databaseName = "curveball";
const roleName = "curveball_owner";
const parentHost = "ep-shy-scene-b51v5u1l.c-7.us-east-2.aws.neon.tech";
const backupName = "v2-pre-migration-20260930";
const rehearsalName = "v2-migration-rehearsal-20260930";
const confirmation = "MIGRATE_CURVEBALL_V2_NEON_TESTNET_11155931";
const migrationHash = "2ba1d120c0ae5c2f7921ddc39257b06d8f5e7c9790135290e1c569315c0d64c1";
const priorHashes = [
  "6215acf4b024360d40546c48ff74235136461fc0445ba1612ca3126d6fbf673e",
  "79826d8de288c15bdeedda177de88dac4004a856b55eae5aefd73c87bebcab44",
  "c30041c677df88991a1852b374419f5381017fd033a8ae5ebfbc1db4859407b8",
];
const requiredColumns = [
  ["tokens", "deployment"],
  ["tokens", "curve"],
  ["trades", "gross_curve_quote"],
  ["trades", "fee_quote"],
  ["trades", "creator_tax_quote"],
  ["protocol_events", "event_key"],
  ["protocol_events", "deployment"],
];

function cli(args: string[]): string {
  const result = Bun.spawnSync(["neon", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Neon CLI failed: ${args[0]} ${args[1] ?? ""}`);
  return new TextDecoder().decode(result.stdout).trim();
}

function directUrl(branch: string): string {
  const raw = cli([
    "connection-string",
    branch,
    "--project-id",
    projectId,
    "--role-name",
    roleName,
    "--database-name",
    databaseName,
  ]);
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname.includes("-pooler") || !url.hostname.endsWith(".neon.tech")) {
    throw new Error("Neon returned an invalid direct connection");
  }
  if (url.pathname !== `/${databaseName}` || url.username !== roleName) {
    throw new Error("Neon returned a connection for another database or role");
  }
  return raw;
}

async function inspect(url: string, expectedHashes: string[], phase: "pending" | "applied") {
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    const [identity] = await sql`select current_database() as database, current_user as role`;
    const parsed = new URL(url);
    if (identity.database !== parsed.pathname.slice(1) || identity.role !== decodeURIComponent(parsed.username)) {
      throw new Error("Connected to an unexpected database or role");
    }
    const migrations = await sql`select hash from drizzle.__drizzle_migrations order by created_at`;
    assertMigrationHistory(migrations.map((row) => row.hash), expectedHashes, phase);
    if (phase === "applied") {
      const columns = await sql`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('tokens', 'trades', 'protocol_events')
      `;
      const found = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
      for (const [table, column] of requiredColumns) {
        if (!found.has(`${table}.${column}`)) throw new Error(`Missing V2 column ${table}.${column}`);
      }
      const indexes = await sql`
        select indexname from pg_indexes where schemaname = 'public'
          and indexname in ('protocol_events_event_key_unique', 'protocol_events_launch_time_idx')
      `;
      if (indexes.length !== 2) throw new Error("Missing V2 protocol event indexes");
    }
  } finally {
    await sql.end();
  }
}

function migrate(url: string, label: string): void {
  const result = Bun.spawnSync(["bun", "run", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: url, EXPECTED_CHAIN_ID: "11155931" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`${label} Drizzle migration failed; inspect the database before retrying`);
  console.log(`${label} Drizzle migration completed`);
}

async function main(): Promise<void> {
  const preflight = parseMigrationMode(process.argv.slice(2));
  if (Bun.env.CONFIRM_V2_DB_MIGRATION !== confirmation) throw new Error("Missing exact V2 database migration confirmation");
  const sqlText = await Bun.file(new URL("../drizzle/0003_orange_the_twelve.sql", import.meta.url)).text();
  if (createHash("sha256").update(sqlText).digest("hex") !== migrationHash) {
    throw new Error("V2 migration SQL changed since review");
  }
  const productionUrl = directUrl(parentName);
  assertDirectTarget(productionUrl, parentHost, databaseName, roleName);
  await executeV2Migration({
    async assertBranchesAbsent() {
      const branches = JSON.parse(cli(["branches", "list", "--project-id", projectId, "-o", "json"]));
      if (!Array.isArray(branches) || !branches.some((branch) => branch.id === parentId && branch.name === parentName)) {
        throw new Error("Expected testnet Neon parent branch is missing");
      }
      if (branches.some((branch) => [backupName, rehearsalName].includes(branch.name))) {
        throw new Error("A V2 migration backup or rehearsal branch already exists; inspect before retrying");
      }
    },
    inspectProductionPending: () => inspect(productionUrl, priorHashes, "pending"),
    async createRehearsal() {
      cli(["branches", "create", "--project-id", projectId, "--parent", parentId, "--name", rehearsalName, "--no-secrets"]);
      console.log(`Created rehearsal branch ${rehearsalName}`);
    },
    async rehearse() {
      const rehearsalUrl = directUrl(rehearsalName);
      if (new URL(rehearsalUrl).hostname === parentHost) throw new Error("Rehearsal resolved to the production endpoint");
      await inspect(rehearsalUrl, priorHashes, "pending");
      migrate(rehearsalUrl, "Rehearsal");
      await inspect(rehearsalUrl, [...priorHashes, migrationHash], "applied");
    },
    async createBackup() {
      cli(["branches", "create", "--project-id", projectId, "--parent", parentId, "--name", backupName, "--no-compute", "--no-secrets"]);
      console.log(`Created pre-migration Neon backup branch ${backupName}`);
    },
    migrateProduction: async () => migrate(productionUrl, "Testnet target"),
    verifyProduction: () => inspect(productionUrl, [...priorHashes, migrationHash], "applied"),
  }, preflight);
  if (preflight) {
    console.log("V2 testnet migration preflight passed; no branches or schema changed");
  } else {
    console.log(`V2 testnet database migration verified; backup: ${backupName}`);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : "V2 migration failed");
  process.exitCode = 1;
});

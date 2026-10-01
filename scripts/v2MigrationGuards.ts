export function assertDirectTarget(directRaw: string, expectedHost: string, expectedDatabase: string, expectedRole: string): void {
  const direct = new URL(directRaw);
  if (
    direct.protocol !== "postgresql:" ||
    direct.hostname !== expectedHost ||
    direct.username !== expectedRole ||
    direct.pathname !== `/${expectedDatabase}` ||
    direct.searchParams.get("sslmode") !== "require"
  ) {
    throw new Error("Direct Neon URL does not match the approved testnet database");
  }
}

export type MigrationOperations = {
  assertBranchesAbsent(): Promise<void>;
  inspectProductionPending(): Promise<void>;
  createRehearsal(): Promise<void>;
  rehearse(): Promise<void>;
  createBackup(): Promise<void>;
  migrateProduction(): Promise<void>;
  verifyProduction(): Promise<void>;
};

export async function executeV2Migration(operations: MigrationOperations, preflight: boolean): Promise<void> {
  await operations.assertBranchesAbsent();
  await operations.inspectProductionPending();
  if (preflight) return;
  await operations.createRehearsal();
  await operations.rehearse();
  await operations.inspectProductionPending();
  await operations.createBackup();
  await operations.inspectProductionPending();
  await operations.migrateProduction();
  await operations.verifyProduction();
}

export function assertMigrationHistory(
  actual: string[],
  expected: string[],
  phase: "pending" | "applied",
): void {
  if (actual.length !== expected.length || actual.some((hash, i) => hash !== expected[i])) {
    throw new Error(`Unexpected ${phase} Drizzle migration history`);
  }
}

export function parseMigrationMode(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--preflight") return true;
  throw new Error("Only --preflight is accepted as a migration argument");
}

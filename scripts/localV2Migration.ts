const factory = "0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf";

export function assertLocalV2MigrationTarget(env: Record<string, string | undefined>): void {
  if (env.EXPECTED_CHAIN_ID !== "11155931" || env.CONTRACT_VERSION !== "v2" ||
      env.LAUNCHPAD_ADDRESS?.toLowerCase() !== factory.toLowerCase() ||
      env.INDEXER_START_BLOCK !== "55636468") {
    throw new Error("Local V2 migration requires the recorded RISE Testnet deployment.");
  }
  if (env.DATABASE_SSL !== "false" || !env.DATABASE_URL) {
    throw new Error("Local V2 migration requires a non-SSL local database URL.");
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("Local V2 migration requires a valid database URL.");
  }
  if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.port !== "5433" || url.pathname !== "/curveball" || url.username !== "curveball" ||
      !url.password || url.search || url.hash) {
    throw new Error("Local V2 migration is restricted to the Compose curveball database on localhost:5433.");
  }
}

if (import.meta.main) {
  assertLocalV2MigrationTarget(Bun.env);
  const child = Bun.spawn(["bun", "run", "db:migrate"], {
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}

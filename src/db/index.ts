import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { expectedChainId } from "../expectedChainId";

const mainnet = expectedChainId(Bun.env.EXPECTED_CHAIN_ID, 11_155_931) === 4_153;
const databaseUrl = mainnet ? Bun.env.MAINNET_DATABASE_URL : Bun.env.DATABASE_URL;
if (!databaseUrl) throw new Error(mainnet ? "MAINNET_DATABASE_URL is required" : "DATABASE_URL is required");
if (mainnet && databaseUrl === Bun.env.DATABASE_URL) {
  throw new Error("Mainnet and testnet databases must be separate.");
}

const client = postgres(databaseUrl, {
  prepare: false,
  ...(Bun.env.DATABASE_SSL === "true" ? { ssl: "require" as const } : {}),
});

export const db = drizzle(client, { schema });
export const closeDatabase = () => client.end();

// Export type for Cloudflare Workers compatibility
export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

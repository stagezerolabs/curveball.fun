import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = Bun.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, { prepare: false });

export const db = drizzle(client, { schema });
export const closeDatabase = () => client.end();

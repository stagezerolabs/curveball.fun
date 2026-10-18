import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { CurveballDatabase } from "./client.js";

export async function migrateDatabase(
  database: CurveballDatabase,
  migrationsFolder: string,
): Promise<void> {
  await migrate(database.db, {
    migrationsFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "__drizzle_migrations",
  });
}

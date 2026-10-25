import { fileURLToPath } from "node:url";
import { createDatabase, migrateDatabase } from "@curveball/db";
import { databaseSsl } from "./databaseSsl.mjs";

const connectionString = (
  process.env.SOCIAL_DIRECT_DATABASE_URL ||
  process.env.SOCIAL_DATABASE_URL ||
  ""
).trim();

if (!connectionString) {
  throw new Error(
    "SOCIAL_DIRECT_DATABASE_URL or SOCIAL_DATABASE_URL is required.",
  );
}

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/db/drizzle", import.meta.url),
);
const database = createDatabase({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 15_000,
  ssl: databaseSsl(),
});

try {
  await migrateDatabase(database, migrationsFolder);
  console.log("Curveball database migrations are current.");
} finally {
  await database.pool.end();
}

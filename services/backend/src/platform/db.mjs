import { createDatabase } from "@curveball/db";
import { config } from "./config.mjs";
import { databaseSsl } from "./databaseSsl.mjs";

const database = createDatabase({
  connectionString: config.databaseUrl,
  max: Number(process.env.SOCIAL_DB_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: databaseSsl(),
});

export const { db, pool, transaction } = database;

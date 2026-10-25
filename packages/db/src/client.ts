import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolClient, type PoolConfig } from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export type CurveballDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(config: PoolConfig) {
  const pool = new Pool({
    ...config,
    options: [config.options, "-c search_path=curveball,public"]
      .filter(Boolean)
      .join(" "),
  });
  const db = drizzle(pool, { schema });

  async function transaction<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return { db, pool, transaction };
}

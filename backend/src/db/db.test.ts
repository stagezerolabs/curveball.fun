import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = Bun.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "the Postgres migration and schema work together",
  async () => {
    Bun.env.DATABASE_URL = databaseUrl;
    const [{ db, closeDatabase }, { tokens }] = await Promise.all([
      import("./index"),
      import("./schema"),
    ]);

    try {
      await migrate(db, {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle", import.meta.url),
        ),
      });
      await db
        .insert(tokens)
        .values({
          address: "0x000000000000000000000000000000000000c0de",
          name: "Curveball",
          symbol: "CURVE",
          creator: "test",
        })
        .onConflictDoNothing({ target: tokens.address });

      const [token] = await db
        .select()
        .from(tokens)
        .where(
          eq(tokens.address, "0x000000000000000000000000000000000000c0de"),
        );

      expect(token?.symbol).toBe("CURVE");
      expect(token?.graduated).toBe(false);
    } finally {
      await closeDatabase();
    }
  },
);

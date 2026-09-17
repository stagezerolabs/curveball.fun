import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = Bun.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "the schema and concurrent indexer work with Postgres",
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

      const { indexerState } = await import("./schema");
      const [state] = await db
        .select({
          value: indexerState.value,
          updatedAt: indexerState.updatedAt,
        })
        .from(indexerState)
        .where(eq(indexerState.key, "last_block"));
      const start = BigInt(state?.value || "0");
      const rpc = Bun.serve({
        port: 0,
        async fetch(request) {
          const { id, method } = await request.json();
          return Response.json({
            jsonrpc: "2.0",
            id,
            result:
              method === "eth_blockNumber" ? `0x${start.toString(16)}` : [],
          });
        },
      });
      Bun.env.LAUNCHPAD_ADDRESS = "0x0000000000000000000000000000000000000001";
      Bun.env.RPC_URL = rpc.url.toString();
      try {
        const { indexToHead } = await import("../indexer");
        await Promise.all([indexToHead(), indexToHead()]);
        const [next] = await db
          .select({ value: indexerState.value })
          .from(indexerState)
          .where(eq(indexerState.key, "last_block"));
        expect(next.value).toBe((start + 1n).toString());
      } finally {
        rpc.stop(true);
        const whereTestCursor = and(
          eq(indexerState.key, "last_block"),
          eq(indexerState.value, (start + 1n).toString()),
        );
        if (state) {
          await db
            .update(indexerState)
            .set({ value: state.value, updatedAt: state.updatedAt })
            .where(whereTestCursor);
        } else {
          await db.delete(indexerState).where(whereTestCursor);
        }
      }
    } finally {
      await closeDatabase();
    }
  },
);

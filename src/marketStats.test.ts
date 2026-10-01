import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const databaseUrl = Bun.env.TEST_DATABASE_URL;

const TOKEN = "0x00000000000000000000000000000000000f1xed";
const V2_TOKEN = "0x00000000000000000000000000000000000f2eed";
const ALICE = "0xa11ce00000000000000000000000000000000000";
const BOB = "0xb0b0000000000000000000000000000000000000";

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000);

test.skipIf(!databaseUrl)(
  "market stats derive volume, holders and 24h change from indexed trades",
  async () => {
    Bun.env.DATABASE_URL = databaseUrl;
    Bun.env.DATABASE_SSL = databaseUrl!.includes("sslmode=require") ? "true" : "false";
    const [{ db, closeDatabase }, { trades }, { marketStats }] =
      await Promise.all([
        import("./db"),
        import("./db/schema"),
        import("./marketStats"),
      ]);

    try {
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      await db.delete(trades).where(eq(trades.token, TOKEN));

      // price = quote / amount. 30h ago: 1.0, then 2.0 and 4.0 inside the window.
      await db.insert(trades).values([
        {
          eventKey: `${TOKEN}:0`,
          token: TOKEN,
          trader: ALICE,
          side: "buy",
          quote: (10n ** 18n).toString(),
          amount: (10n ** 18n).toString(),
          tx: "0xdead",
          blockTime: hoursAgo(30),
        },
        {
          eventKey: `${TOKEN}:1`,
          token: TOKEN,
          trader: ALICE,
          side: "buy",
          quote: (4n * 10n ** 18n).toString(),
          amount: (2n * 10n ** 18n).toString(),
          tx: "0xbeef",
          blockTime: hoursAgo(5),
        },
        {
          eventKey: `${TOKEN}:2`,
          token: TOKEN,
          trader: BOB,
          side: "buy",
          quote: (4n * 10n ** 18n).toString(),
          amount: (10n ** 18n).toString(),
          tx: "0xcafe",
          blockTime: hoursAgo(1),
        },
        // Bob sells his whole position back out, so he stops counting as a holder.
        {
          eventKey: `${TOKEN}:3`,
          token: TOKEN,
          trader: BOB,
          side: "sell",
          quote: (4n * 10n ** 18n).toString(),
          amount: (10n ** 18n).toString(),
          tx: "0xfeed",
          blockTime: hoursAgo(1),
        },
      ]);

      const stat = (await marketStats(db)).get(TOKEN);

      // Only the three trades inside the window count: 4 + 4 + 4 ETH.
      expect(stat?.volume24h).toBeCloseTo(12, 6);
      // Alice holds 3 tokens; Bob is net zero.
      expect(stat?.holders).toBe(1);
      // Last price 4.0 against the 1.0 reference from before the window.
      expect(stat?.change24h).toBeCloseTo(300, 6);
      expect(stat?.peakPrice).toBeCloseTo(4, 6);
      expect(stat?.lastPrice).toBeCloseTo(4, 6);
      expect(stat?.priceHistory?.length).toBeGreaterThan(0);

      await db.insert(trades).values({
        eventKey: `${V2_TOKEN}:0`, token: V2_TOKEN, trader: ALICE, side: "buy",
        quote: (105n * 10n ** 16n).toString(),
        grossCurveQuote: (100n * 10n ** 16n).toString(),
        feeQuote: (5n * 10n ** 16n).toString(),
        creatorTaxQuote: "0", amount: (10n ** 18n).toString(), tx: "0xf2eed",
        blockTime: hoursAgo(1),
      });
      const v2 = (await marketStats(db)).get(V2_TOKEN);
      expect(v2?.volume24h).toBeCloseTo(1.05, 6);
      expect(v2?.lastPrice).toBeCloseTo(1, 6);
      expect(v2?.priceHistory).toEqual([1]);
    } finally {
      const { trades } = await import("./db/schema");
      const { db, closeDatabase } = await import("./db");
      await db.delete(trades).where(eq(trades.token, TOKEN));
      await db.delete(trades).where(eq(trades.token, V2_TOKEN));
      await closeDatabase();
    }
  },
  30_000,
);

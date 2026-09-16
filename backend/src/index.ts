import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, http, parseAbiItem } from "viem";
import { db } from "./db";
import { indexerState, tokens, trades } from "./db/schema";

const app = new Hono();
app.use("/*", cors({ origin: Bun.env.CORS_ORIGIN || "http://localhost:5173" }));
app.get("/health", async (c) => {
  await db.execute(sql`SELECT 1`);
  return c.json({ ok: true });
});
app.get("/tokens", async (c) => {
  const rows = await db
    .select({
      address: tokens.address,
      name: tokens.name,
      symbol: tokens.symbol,
      creator: tokens.creator,
      graduated: tokens.graduated,
      pool: tokens.pool,
    })
    .from(tokens)
    .where(isNull(tokens.deletedAt))
    .orderBy(desc(tokens.graduated));
  return c.json(rows);
});
app.get("/tokens/:address", async (c) => {
  const [token] = await db
    .select({
      address: tokens.address,
      name: tokens.name,
      symbol: tokens.symbol,
      creator: tokens.creator,
      graduated: tokens.graduated,
      pool: tokens.pool,
    })
    .from(tokens)
    .where(
      and(eq(tokens.address, c.req.param("address")), isNull(tokens.deletedAt)),
    )
    .limit(1);
  return token ? c.json(token) : c.json({ error: "not found" }, 404);
});
app.get("/tokens/:address/transactions", async (c) => {
  const rows = await db
    .select({
      id: trades.id,
      event_key: trades.eventKey,
      token: trades.token,
      trader: trades.trader,
      side: trades.side,
      quote: trades.quote,
      amount: trades.amount,
      tx: trades.tx,
    })
    .from(trades)
    .where(
      and(eq(trades.token, c.req.param("address")), isNull(trades.deletedAt)),
    )
    .orderBy(desc(trades.createdAt));
  return c.json(rows);
});
app.get("/tokens/:address/graduation", async (c) => {
  const [token] = await db
    .select({ graduated: tokens.graduated, pool: tokens.pool })
    .from(tokens)
    .where(
      and(eq(tokens.address, c.req.param("address")), isNull(tokens.deletedAt)),
    )
    .limit(1);
  return token ? c.json(token) : c.json({ error: "not found" }, 404);
});
const address = Bun.env.LAUNCHPAD_ADDRESS as `0x${string}`;
if (address && /^0x[0-9a-fA-F]{40}$/.test(address)) {
  const client = createPublicClient({
      transport: http(Bun.env.RPC_URL || "http://127.0.0.1:8545"),
    }),
    events = [
      parseAbiItem(
        "event TokenCreated(address indexed token,address indexed creator,string name,string symbol,string uri)",
      ),
      parseAbiItem(
        "event Trade(address indexed token,address indexed trader,bool isBuy,uint256 quoteAmount,uint256 tokenAmount,uint256 vQAfter,uint256 vTAfter,uint256 soldAfter)",
      ),
      parseAbiItem(
        "event Graduated(address indexed token,address indexed pool,uint256 tokenLiquidity,uint256 quoteLiquidity,uint256 liquidity)",
      ),
    ];
  let delay = 2000;
  const tick = async () => {
    try {
      const [state] = await db
        .select({ value: indexerState.value })
        .from(indexerState)
        .where(eq(indexerState.key, "last_block"))
        .limit(1);
      let from = BigInt(state?.value || "0"),
        to = await client.getBlockNumber();
      while (from <= to) {
        const end = from + 999n < to ? from + 999n : to;
        for (const event of events)
          for (const log of await client.getLogs({
            address,
            event,
            fromBlock: from,
            toBlock: end,
          })) {
            const a: any = log.args,
              key = `${log.transactionHash}:${log.logIndex}`;
            if (event.name === "TokenCreated")
              await db
                .insert(tokens)
                .values({
                  address: a.token,
                  name: a.name,
                  symbol: a.symbol,
                  creator: a.creator,
                })
                .onConflictDoNothing({ target: tokens.address });
            if (event.name === "Trade")
              await db
                .insert(trades)
                .values({
                  eventKey: key,
                  token: a.token,
                  trader: a.trader,
                  side: a.isBuy ? "buy" : "sell",
                  quote: a.quoteAmount.toString(),
                  amount: a.tokenAmount.toString(),
                  tx: log.transactionHash,
                })
                .onConflictDoNothing({ target: trades.eventKey });
            if (event.name === "Graduated")
              await db
                .update(tokens)
                .set({
                  graduated: true,
                  pool: a.pool,
                  updatedAt: new Date(),
                })
                .where(eq(tokens.address, a.token));
          }
        await db
          .insert(indexerState)
          .values({
            key: "last_block",
            value: (end + 1n).toString(),
          })
          .onConflictDoUpdate({
            target: indexerState.key,
            set: {
              value: (end + 1n).toString(),
              updatedAt: new Date(),
            },
          });
        from = end + 1n;
      }
      delay = 2000;
    } catch (e) {
      console.error("indexer", e);
      delay = Math.min(delay * 2, 30000);
    }
    setTimeout(tick, delay);
  };
  void tick();
}
console.log(`Curveball API http://localhost:${Bun.env.PORT || 3001}`);
export default { port: Number(Bun.env.PORT || 3001), fetch: app.fetch };

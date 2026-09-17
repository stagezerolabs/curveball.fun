import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, http, parseAbiItem } from "viem";
import { db } from "./db";
import { indexerState, tokens, trades } from "./db/schema";

const launchpadAddress = Bun.env.LAUNCHPAD_ADDRESS as `0x${string}` | undefined;
const hasLaunchpad = Boolean(
  launchpadAddress && /^0x[0-9a-fA-F]{40}$/.test(launchpadAddress),
);
const rpcUrl = Bun.env.RPC_URL || "http://127.0.0.1:8545";
const launchpadAbi = [
  parseAbiItem("function supply() view returns (uint256)"),
  parseAbiItem("function curveSupply() view returns (uint256)"),
  parseAbiItem(
    "function markets(address) view returns (address creator,uint128 vt,uint128 vq,uint128 realQ,uint128 sold,bool graduated,bool pending,address pool)",
  ),
];
const publicClient = hasLaunchpad
  ? createPublicClient({ transport: http(rpcUrl) })
  : null;

let curveConstants: { supply: bigint; curveSupply: bigint } | null = null;
async function getCurveConstants() {
  if (curveConstants || !publicClient) return curveConstants;
  const [supply, curveSupply] = await Promise.all([
    publicClient.readContract({
      address: launchpadAddress as `0x${string}`,
      abi: launchpadAbi,
      functionName: "supply",
    }),
    publicClient.readContract({
      address: launchpadAddress as `0x${string}`,
      abi: launchpadAbi,
      functionName: "curveSupply",
    }),
  ]);
  curveConstants = { supply, curveSupply };
  return curveConstants;
}

// Reads on-chain curve state per row and merges {price, marketCap, progress}.
// Best-effort: any read failure (or no configured launchpad) leaves those
// fields absent rather than failing the whole /tokens response.
async function enrichWithMarketData<T extends { address: string; graduated: boolean }>(
  rows: T[],
) {
  if (!publicClient || rows.length === 0) return rows;
  try {
    const constants = await getCurveConstants();
    if (!constants) return rows;
    const supplyHuman = Number(constants.supply) / 1e18;
    const results = await Promise.allSettled(
      rows.map((row) =>
        publicClient.readContract({
          address: launchpadAddress as `0x${string}`,
          abi: launchpadAbi,
          functionName: "markets",
          args: [row.address as `0x${string}`],
        }),
      ),
    );
    return rows.map((row, i) => {
      const result = results[i];
      if (!result || result.status !== "fulfilled") return row;
      const [, , , realQ, sold, onChainGraduated] = result.value;
      const soldNum = Number(sold);
      const progress =
        constants.curveSupply > 0n
          ? Math.min(100, (soldNum / Number(constants.curveSupply)) * 100)
          : 0;
      let price: number | null = null;
      let marketCap: number | null = null;
      if (!onChainGraduated && soldNum > 0) {
        price = Number(realQ) / soldNum;
        marketCap = price * supplyHuman;
      }
      return {
        ...row,
        graduated: row.graduated || onChainGraduated,
        price,
        marketCap,
        progress,
      };
    });
  } catch (error) {
    console.error("market data enrichment", error);
    return rows;
  }
}

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
      imageUrl: tokens.imageUrl,
      description: tokens.description,
      website: tokens.website,
      xHandle: tokens.xHandle,
      telegram: tokens.telegram,
      createdAt: tokens.createdAt,
    })
    .from(tokens)
    .where(isNull(tokens.deletedAt))
    .orderBy(desc(tokens.graduated));
  return c.json(await enrichWithMarketData(rows));
});
const metadataValidators: Record<
  string,
  (value: unknown) => string | null | undefined
> = {
  imageUrl: (value) => validateOptionalUrl(value, 500),
  website: (value) => validateOptionalUrl(value, 300),
  description: (value) => validateOptionalText(value, 500),
  xHandle: (value) => validateOptionalText(value, 60),
  telegram: (value) => validateOptionalText(value, 60),
};
function validateOptionalText(value: unknown, maxLength: number) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error("invalid field");
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
function validateOptionalUrl(value: unknown, maxLength: number) {
  const trimmed = validateOptionalText(value, maxLength);
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw new Error("invalid url");
  }
  return trimmed;
}
app.patch("/tokens/:address/metadata", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }
  const fields: Record<string, string | null> = {};
  for (const key of Object.keys(metadataValidators)) {
    if (!(key in body)) continue;
    try {
      fields[key] = metadataValidators[key](body[key]) ?? null;
    } catch {
      return c.json({ error: `invalid ${key}` }, 400);
    }
  }
  if (Object.keys(fields).length === 0) {
    return c.json({ error: "no valid metadata fields provided" }, 400);
  }
  const [updated] = await db
    .update(tokens)
    .set(fields)
    .where(
      and(
        eq(tokens.address, c.req.param("address")),
        isNull(tokens.deletedAt),
      ),
    )
    .returning();
  return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
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
if (publicClient && launchpadAddress) {
  const client = publicClient,
    address = launchpadAddress,
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

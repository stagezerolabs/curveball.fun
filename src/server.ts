import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createPublicClient, http, parseAbiItem } from "viem";
import { db } from "./db";
import { tokens, trades } from "./db/schema";

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
async function enrichWithMarketData<
  T extends { address: string; graduated: boolean },
>(rows: T[]) {
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

const api = new Hono();

api.get("/health", async (c) => {
  await db.execute(sql`SELECT 1`);
  return c.json({ ok: true });
});

api.get("/tokens", async (c) => {
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
api.get("/tokens/:address/transactions", async (c) => {
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

const app = new Hono();

app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
// Production only: in dev Vite serves the client and proxies /api here.
app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", serveStatic({ path: "./dist/index.html" }));

const port = Number(Bun.env.PORT || 3001);
console.log(`Curveball http://localhost:${port}`);
export default { port, fetch: app.fetch };

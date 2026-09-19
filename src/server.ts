import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createPublicClient, http, parseAbiItem } from "viem";
import { db } from "./db";
import { tokens, trades } from "./db/schema";
import { readChainRuntime } from "./runtimeConfig";
import {
  candles,
  holders,
  isCandleRange,
  marketStats,
  position,
  type TokenStats,
} from "./marketStats";

const runtime = readChainRuntime(Bun.env);
const launchpadAddress = runtime.launchpadAddress ?? undefined;
const hasLaunchpad = Boolean(launchpadAddress);
const launchpadAbi = [
  parseAbiItem("function supply() view returns (uint256)"),
  parseAbiItem("function curveSupply() view returns (uint256)"),
  parseAbiItem("function quote() view returns (address)"),
  parseAbiItem("function initialVQ() view returns (uint256)"),
  parseAbiItem("function locker() view returns (address)"),
  parseAbiItem(
    "function markets(address) view returns (address creator,uint128 vt,uint128 vq,uint128 realQ,uint128 sold,bool graduated,bool pending,address pool)",
  ),
];
const publicClient = hasLaunchpad
  ? createPublicClient({ transport: http(runtime.rpcUrl) })
  : null;

async function assertChainDeployment() {
  if (!publicClient || !launchpadAddress) return;
  const [chainId, bytecode] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBytecode({ address: launchpadAddress }),
  ]);
  if (chainId !== runtime.expectedChainId) {
    throw new Error(
      `RPC chain mismatch: expected ${runtime.expectedChainId}, received ${chainId}.`,
    );
  }
  if (!bytecode || bytecode === "0x") {
    throw new Error("No launchpad bytecode exists at LAUNCHPAD_ADDRESS.");
  }
}

const erc20Abi = [parseAbiItem("function symbol() view returns (string)")];
const lockerAbi = [
  parseAbiItem("function creatorShareBps() view returns (uint16)"),
  parseAbiItem("function treasury() view returns (address)"),
];

// The launchpad's quote token never changes, so read it once and keep serving
// the cached symbol even if a later RPC call fails.
let quoteSymbol: string | null = null;
let quoteToken: string | null = null;
async function getQuoteSymbol() {
  if (quoteSymbol || !publicClient) return quoteSymbol;
  try {
    const quote = await publicClient.readContract({
      address: launchpadAddress as `0x${string}`,
      abi: launchpadAbi,
      functionName: "quote",
    });
    quoteToken = quote;
    quoteSymbol = await publicClient.readContract({
      address: quote,
      abi: erc20Abi,
      functionName: "symbol",
    });
  } catch (error) {
    console.error("quote symbol", error);
  }
  return quoteSymbol;
}

type CurveConstants = {
  supply: bigint;
  curveSupply: bigint;
  initialVQ: bigint;
  /**
   * Spot price the curve reaches at graduation. The market starts at
   * vt = supply, vq = initialVQ and holds k = vt * vq, so once `sold` reaches
   * curveSupply: vt = supply - curveSupply, vq = k / vt, and price = vq / vt.
   * That collapses to k / vt^2 — a launchpad-wide constant, not per token.
   */
  targetPrice: number;
};

let curveConstants: CurveConstants | null = null;
async function getCurveConstants() {
  if (curveConstants || !publicClient) return curveConstants;
  const read = (functionName: "supply" | "curveSupply" | "initialVQ") =>
    publicClient.readContract({
      address: launchpadAddress as `0x${string}`,
      abi: launchpadAbi,
      functionName,
    });
  const [supply, curveSupply, initialVQ] = await Promise.all([
    read("supply"),
    read("curveSupply"),
    read("initialVQ"),
  ]);
  const remaining = Number(supply) - Number(curveSupply);
  curveConstants = {
    supply,
    curveSupply,
    initialVQ,
    targetPrice:
      remaining > 0
        ? (Number(supply) * Number(initialVQ)) / (remaining * remaining)
        : 0,
  };
  return curveConstants;
}

// Launchpad-wide settings the UI needs once, not per token.
let launchpadConfig: {
  quoteSymbol: string | null;
  quoteToken: string | null;
  targetPrice: number | null;
  creatorShareBps: number | null;
  treasury: string | null;
  locker: string | null;
} | null = null;
async function getLaunchpadConfig() {
  if (launchpadConfig) return launchpadConfig;
  const constants = await getCurveConstants().catch(() => null);
  const config = {
    quoteSymbol: await getQuoteSymbol(),
    quoteToken,
    targetPrice: constants?.targetPrice ?? null,
    creatorShareBps: null as number | null,
    treasury: null as string | null,
    locker: null as string | null,
  };
  if (publicClient) {
    try {
      const locker = await publicClient.readContract({
        address: launchpadAddress as `0x${string}`,
        abi: launchpadAbi,
        functionName: "locker",
      });
      const [creatorShareBps, treasury] = await Promise.all([
        publicClient.readContract({
          address: locker,
          abi: lockerAbi,
          functionName: "creatorShareBps",
        }),
        publicClient.readContract({
          address: locker,
          abi: lockerAbi,
          functionName: "treasury",
        }),
      ]);
      config.locker = locker;
      config.creatorShareBps = Number(creatorShareBps);
      config.treasury = treasury;
    } catch (error) {
      console.error("launchpad config", error);
      return config; // Not cached: a transient RPC failure should be retried.
    }
  }
  launchpadConfig = config;
  return config;
}

// Merges two independent sources onto each token row, both best-effort:
//   - indexed Trade events (volume, holders, 24h change, price history, peak)
//   - live on-chain curve state (price, market cap, progress, graduation)
// Either source failing leaves its fields null rather than failing /tokens, so
// every row comes back with the same shape no matter what is reachable.
async function enrichWithMarketData<
  T extends {
    address: string;
    graduated: boolean;
    quoteLiquidity?: string | null;
  },
>(rows: T[]) {
  if (rows.length === 0) return [];

  const [stats, symbol, constants] = await Promise.all([
    marketStats().catch((error) => {
      console.error("market stats", error);
      return new Map<string, TokenStats>();
    }),
    getQuoteSymbol(),
    getCurveConstants().catch((error) => {
      console.error("curve constants", error);
      return null;
    }),
  ]);

  const supplyHuman = constants ? Number(constants.supply) / 1e18 : null;
  const onChain =
    publicClient && constants
      ? await Promise.allSettled(
          rows.map((row) =>
            publicClient.readContract({
              address: launchpadAddress as `0x${string}`,
              abi: launchpadAbi,
              functionName: "markets",
              args: [row.address as `0x${string}`],
            }),
          ),
        )
      : [];

  return rows.map((row, index) => {
    const { quoteLiquidity, ...rest } = row;
    const stat = stats.get(row.address);
    const merged = {
      ...rest,
      quoteSymbol: symbol,
      liquidity: quoteLiquidity == null ? null : Number(quoteLiquidity) / 1e18,
      volume24h: stat?.volume24h ?? null,
      holders: stat?.holders ?? null,
      change24h: stat?.change24h ?? null,
      priceHistory: stat?.priceHistory ?? null,
      peakMarketCap:
        stat?.peakPrice != null && supplyHuman !== null
          ? stat.peakPrice * supplyHuman
          : null,
      price: null as number | null,
      marketCap: null as number | null,
      progress: null as number | null,
    };

    const result = onChain[index];
    if (!result || result.status !== "fulfilled" || supplyHuman === null)
      return merged;

    const [, vt, vq, , sold, onChainGraduated] = result.value;
    const soldNum = Number(sold);
    // Spot price is vq / vt, the marginal price the next trade pays. The old
    // realQ / sold was an average cost basis, which lags the market and is
    // undefined before the first trade.
    const price =
      !onChainGraduated && Number(vt) > 0 ? Number(vq) / Number(vt) : null;
    return {
      ...merged,
      graduated: merged.graduated || onChainGraduated,
      price,
      marketCap: price === null ? null : price * supplyHuman,
      progress:
        constants && constants.curveSupply > 0n
          ? Math.min(100, (soldNum / Number(constants.curveSupply)) * 100)
          : 0,
    };
  });
}

const api = new Hono();

api.get("/health", async (c) => {
  await Promise.all([db.execute(sql`SELECT 1`), assertChainDeployment()]);
  return c.json({ ok: true, chainId: runtime.expectedChainId });
});

api.get("/metadata/nominatebear", (c) => {
  c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  return c.json({
    name: "NominateBear",
    symbol: "NBR",
    description: "The first token launched on Curveball.",
    website: "https://curveball.fun/markets",
  });
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
      quoteLiquidity: tokens.quoteLiquidity,
      createdAt: tokens.createdAt,
    })
    .from(tokens)
    .where(isNull(tokens.deletedAt))
    .orderBy(desc(tokens.graduated));
  return c.json(await enrichWithMarketData(rows));
});
api.get("/config", async (c) => c.json(await getLaunchpadConfig()));

api.get("/tokens/:address/candles", async (c) => {
  const range = c.req.query("range") || "1D";
  if (!isCandleRange(range))
    return c.json({ error: "unknown range" }, 400);
  return c.json(await candles(c.req.param("address"), range));
});

api.get("/tokens/:address/holders", async (c) =>
  c.json(await holders(c.req.param("address"))),
);

api.get("/tokens/:address/position/:wallet", async (c) =>
  c.json(
    await position(c.req.param("address"), c.req.param("wallet")),
  ),
);

const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

api.get("/tokens/:address/transactions", async (c) => {
  const address = c.req.param("address");
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query("limit")) || PAGE_SIZE),
  );
  const where = and(eq(trades.token, address), isNull(trades.deletedAt));
  const tradedAt = sql`COALESCE(${trades.blockTime}, ${trades.createdAt})`;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: trades.id,
        event_key: trades.eventKey,
        token: trades.token,
        trader: trades.trader,
        side: trades.side,
        quote: trades.quote,
        amount: trades.amount,
        tx: trades.tx,
        tradedAt: sql<string>`${tradedAt}`,
      })
      .from(trades)
      .where(where)
      .orderBy(desc(tradedAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: sql<number>`count(*)::int` }).from(trades).where(where),
  ]);

  return c.json({ rows, total: counted?.total ?? 0, page, limit });
});

export const app = new Hono();

app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
// Production only: in dev Vite serves the client and proxies /api here.
app.use("/*", serveStatic({ root: "./dist" }));
app.get("/*", serveStatic({ path: "./dist/index.html" }));

const port = Number(Bun.env.PORT || 3001);
console.log(`Curveball http://localhost:${port}`);
export default { port, fetch: app.fetch };

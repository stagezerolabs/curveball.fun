import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { createPublicClient, http, parseAbiItem } from "viem";
import { tokens, trades } from "./db/schema";
import { createCoinGeckoEthUsdSource, createEthUsdProvider } from "./ethUsd";
import { addUsdValuation } from "./usdValuation";
import {
  candles,
  holders,
  isCandleRange,
  marketStats,
  position,
  type TokenStats,
} from "./marketStats";

export interface Env {
  DB: any; // Hyperdrive binding
  CONTRACT_VERSION?: "v1" | "v2";
  EXPECTED_CHAIN_ID: string;
  RPC_URL?: string;
  LAUNCHPAD_ADDRESS?: string;
  COINGECKO_API_KEY?: string;
  ASSETS: any; // Workers Static Assets binding
}

export default {
  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    const app = createApp(env);
    return app.fetch(request);
  },

  async scheduled(_event: unknown, env: Env, _ctx: unknown): Promise<void> {
    // Run the indexer on schedule
    await runIndexer(env);
  },
};

function createApp(env: Env) {
  if (env.CONTRACT_VERSION === "v2") throw new Error("V2 requires the indexed Bun API; Cloudflare Worker parity is not configured.");
  const expectedChainId = Number(env.EXPECTED_CHAIN_ID || 11155931);
  const launchpadAddress = env.LAUNCHPAD_ADDRESS ? env.LAUNCHPAD_ADDRESS.toLowerCase() as `0x${string}` : undefined;
  const hasLaunchpad = Boolean(launchpadAddress);
  const rpcUrl = env.RPC_URL || "https://testnet.riselabs.xyz";

  const launchpadAbi = [
    parseAbiItem("function owner() view returns (address)"),
    parseAbiItem("function publicLaunchOpen() view returns (bool)"),
    parseAbiItem("function totalReservedQuote() view returns (uint256)"),
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
    ? createPublicClient({ transport: http(rpcUrl) })
    : null;

  const coinGecko = createCoinGeckoEthUsdSource({
    apiKey: env.COINGECKO_API_KEY?.trim() || undefined,
  });
  const ethUsdProvider = createEthUsdProvider({
    getEthUsd: coinGecko.getEthUsd,
  });

  // Database connection via Hyperdrive
  const client = new Client({
    connectionString: env.DB.connectionString,
  });
  const db = drizzle(client);
  const marketDb = { execute: async (query: Parameters<typeof db.execute>[0]) => (await db.execute(query)).rows };

  async function assertChainDeployment() {
    if (!publicClient || !launchpadAddress) return;
    const [chainId, bytecode] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getBytecode({ address: launchpadAddress }),
    ]);
    if (chainId !== expectedChainId) {
      throw new Error(
        `RPC chain mismatch: expected ${expectedChainId}, received ${chainId}.`,
      );
    }
    if (!bytecode || bytecode === "0x") {
      throw new Error("No launchpad bytecode exists at LAUNCHPAD_ADDRESS.");
    }
    if (expectedChainId === 4_153) {
      await Promise.all(["owner", "publicLaunchOpen", "totalReservedQuote"].map((functionName) =>
        publicClient.readContract({ address: launchpadAddress, abi: launchpadAbi, functionName: functionName as "owner" | "publicLaunchOpen" | "totalReservedQuote" }),
      ));
    }
  }

  const erc20Abi = [parseAbiItem("function symbol() view returns (string)")];
  const lockerAbi = [
    parseAbiItem("function creatorShareBps() view returns (uint16)"),
    parseAbiItem("function treasury() view returns (address)"),
  ];

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

  let launchpadConfig: {
    chainId: number;
    launchpadAddress: string | null;
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
      chainId: expectedChainId,
      launchpadAddress: launchpadAddress ?? null,
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
        return config;
      }
    }
    launchpadConfig = config;
    return config;
  }

  async function enrichWithMarketData<
    T extends {
      address: string;
      graduated: boolean;
      quoteLiquidity?: string | null;
    },
  >(rows: T[]) {
    if (rows.length === 0) return [];

    const [stats, symbol, constants, ethUsdRate] = await Promise.all([
      marketStats(marketDb).catch((error) => {
        console.error("market stats", error);
        return new Map<string, TokenStats>();
      }),
      getQuoteSymbol(),
      getCurveConstants().catch((error) => {
        console.error("curve constants", error);
        return null;
      }),
      ethUsdProvider.getRate().catch((error) => {
        console.error("ETH/USD rate", error);
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
        return addUsdValuation(merged, ethUsdRate);

      const [, vt, vq, , sold, onChainGraduated, pending] = result.value;
      const soldNum = Number(sold);
      const price =
        !onChainGraduated && Number(vt) > 0 ? Number(vq) / Number(vt) : null;
      return addUsdValuation({
        ...merged,
        graduated: merged.graduated || onChainGraduated,
        pending,
        price,
        marketCap: price === null ? null : price * supplyHuman,
        progress:
          constants && constants.curveSupply > 0n
            ? Math.min(100, (soldNum / Number(constants.curveSupply)) * 100)
            : 0,
      }, ethUsdRate);
    });
  }

  const api = new Hono();

  api.get("/health", async (c) => {
    await client.connect();
    try {
      await Promise.all([db.execute(sql`SELECT 1`), assertChainDeployment()]);
      return c.json({ ok: true, chainId: expectedChainId, contractVersion: "v1", launchpadAddress: launchpadAddress ?? null });
    } finally {
      await client.end();
    }
  });

  api.get("/metadata/nominatebear", (c) => {
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return c.json({
      name: "NominateBear",
      symbol: "NBR",
      description: "The first token launched on Curveball.",
      website: "https://curveball-fun.netlify.app/markets",
    });
  });

  api.get("/tokens", async (c) => {
    await client.connect();
    try {
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
    } finally {
      await client.end();
    }
  });

  api.get("/config", async (c) => c.json(await getLaunchpadConfig()));

  api.get("/tokens/:address/candles", async (c) => {
    await client.connect();
    try {
      const range = c.req.query("range") || "1D";
      if (!isCandleRange(range))
        return c.json({ error: "unknown range" }, 400);
      return c.json(await candles(marketDb, c.req.param("address"), range));
    } finally {
      await client.end();
    }
  });

  api.get("/tokens/:address/holders", async (c) => {
    await client.connect();
    try {
      return c.json(await holders(marketDb, c.req.param("address")));
    } finally {
      await client.end();
    }
  });

  api.get("/tokens/:address/position/:wallet", async (c) => {
    await client.connect();
    try {
      return c.json(
        await position(marketDb, c.req.param("address"), c.req.param("wallet")),
      );
    } finally {
      await client.end();
    }
  });

  const PAGE_SIZE = 30;
  const MAX_PAGE_SIZE = 100;

  api.get("/tokens/:address/transactions", async (c) => {
    await client.connect();
    try {
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
    } finally {
      await client.end();
    }
  });

  const app = new Hono();
  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  // Serve static assets from Workers Static Assets
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const assetPath = url.pathname;

    try {
      // Try to serve from Workers Static Assets
      const asset = await env.ASSETS.fetch(new Request(assetPath));
      if (asset && asset.status === 200) {
        return asset;
      }

      // Fallback to index.html for SPA routing
      const indexAsset = await env.ASSETS.fetch(new Request("/index.html"));
      return indexAsset || c.text("Not found", 404);
    } catch (error) {
      // If assets binding fails, return error
      return c.text("Static assets not available", 503);
    }
  });

  return app;
}

async function runIndexer(env: Env) {
  if (env.CONTRACT_VERSION === "v2") throw new Error("V2 indexer is not configured on the Cloudflare Worker.");
  const expectedChainId = Number(env.EXPECTED_CHAIN_ID || 11155931);
  const launchpadAddress = env.LAUNCHPAD_ADDRESS ? env.LAUNCHPAD_ADDRESS.toLowerCase() as `0x${string}` : undefined;
  const rpcUrl = env.RPC_URL || "https://testnet.riselabs.xyz";
  const indexerStartBlock = 55002177; // From README

  if (!launchpadAddress) {
    console.log("Indexer disabled: LAUNCHPAD_ADDRESS is not configured");
    return;
  }

  const client = new Client({
    connectionString: env.DB.connectionString,
  });
  const db = drizzle(client);

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const events = [
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

  const cursorKey = `last_block:${expectedChainId}:${launchpadAddress.toLowerCase()}`;

  async function blockTimes(numbers: Set<bigint>) {
    const entries = await Promise.all(
      [...numbers].map(async (blockNumber) => {
        const block = await publicClient.getBlock({ blockNumber });
        return [blockNumber, new Date(Number(block.timestamp) * 1000)] as const;
      }),
    );
    return new Map(entries);
  }

  try {
    await client.connect();

    const chainId = await publicClient.getChainId();
    if (chainId !== expectedChainId) {
      throw new Error(
        `Indexer RPC chain mismatch: expected ${expectedChainId}, received ${chainId}.`,
      );
    }

    // Import indexerState schema
    const { indexerState } = await import("./db/schema");
    const { eq } = await import("drizzle-orm");

    const [state] = await db
      .select({ value: indexerState.value })
      .from(indexerState)
      .where(eq(indexerState.key, cursorKey))
      .limit(1);

    let from = BigInt(state?.value || indexerStartBlock);
    const to = await publicClient.getBlockNumber();

    while (from <= to) {
      const end = from + 999n < to ? from + 999n : to;

      const batches = await Promise.all(
        events.map(async (event) => ({
          event,
          logs: await publicClient.getLogs({
            address: launchpadAddress,
            event,
            fromBlock: from,
            toBlock: end,
          }),
        })),
      );

      const tradeBlocks = new Set<bigint>();
      for (const { event, logs } of batches) {
        if (event.name !== "Trade") continue;
        for (const log of logs) {
          if (log.blockNumber != null) tradeBlocks.add(log.blockNumber);
        }
      }
      const times = await blockTimes(tradeBlocks);

      const applied = await db.transaction(async (tx) => {
        await tx
          .insert(indexerState)
          .values({
            key: cursorKey,
            value: indexerStartBlock.toString(),
          })
          .onConflictDoNothing({ target: indexerState.key });

        const [current] = await tx
          .select({ value: indexerState.value })
          .from(indexerState)
          .where(eq(indexerState.key, cursorKey))
          .for("update");

        if (BigInt(current.value) !== from) return false;

        for (const { event, logs } of batches) {
          for (const log of logs) {
            const args: any = log.args;
            const key = `${log.transactionHash}:${log.logIndex}`;
            if (event.name === "TokenCreated") {
              await tx
                .insert(tokens)
                .values({
                  address: args.token,
                  name: args.name,
                  symbol: args.symbol,
                  creator: args.creator,
                })
                .onConflictDoNothing({ target: tokens.address });
            } else if (event.name === "Trade") {
              await tx
                .insert(trades)
                .values({
                  eventKey: key,
                  token: args.token,
                  trader: args.trader,
                  side: args.isBuy ? "buy" : "sell",
                  quote: args.quoteAmount.toString(),
                  amount: args.tokenAmount.toString(),
                  tx: log.transactionHash,
                  blockNumber: log.blockNumber?.toString() ?? null,
                  blockTime:
                    log.blockNumber == null
                      ? null
                      : (times.get(log.blockNumber) ?? null),
                })
                .onConflictDoNothing({ target: trades.eventKey });
            } else if (event.name === "Graduated") {
              await tx
                .update(tokens)
                .set({
                  graduated: true,
                  pool: args.pool,
                  quoteLiquidity: args.quoteLiquidity?.toString() ?? null,
                  updatedAt: new Date(),
                })
                .where(eq(tokens.address, args.token));
            }
          }
        }

        await tx
          .update(indexerState)
          .set({ value: (end + 1n).toString(), updatedAt: new Date() })
          .where(eq(indexerState.key, cursorKey));

        return true;
      });

      if (!applied) break; // Another worker advanced the cursor
      from = end + 1n;
    }

    console.log(`Indexer completed: processed blocks ${from} to ${to}`);
  } catch (error) {
    console.error("Indexer error:", error);
  } finally {
    await client.end();
  }
}

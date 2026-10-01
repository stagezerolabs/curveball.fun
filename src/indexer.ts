import { eq } from "drizzle-orm";
import { createPublicClient, http, parseAbiItem } from "viem";
import { db } from "./db";
import { indexerState, protocolEvents, tokens, trades } from "./db/schema";
import { readChainRuntime } from "./runtimeConfig";
import { v2FactoryAbi } from "./sdk/v2Contracts";
import { zeroAddress } from "viem";
import { collectV2Logs } from "./v2IndexerQueries";

const runtime = readChainRuntime(Bun.env);
const address = runtime.launchpadAddress ?? undefined;
const cursorKey = `last_block:${runtime.expectedChainId}:${address?.toLowerCase() ?? "none"}`;
if (!address) {
  if (import.meta.main) {
    console.log("Indexer disabled: LAUNCHPAD_ADDRESS is not configured");
    process.exit(0);
  }
  throw new Error("LAUNCHPAD_ADDRESS is required");
}
const client = createPublicClient({
  transport: http(runtime.rpcUrl),
});

async function indexV2ToHead() {
  if (!address) throw new Error("V2 factory address is required");
  const [escrow, vault, locker, hook, wrapper] = await Promise.all([
    client.readContract({ address, abi: v2FactoryAbi, functionName: "escrow" }),
    client.readContract({ address, abi: v2FactoryAbi, functionName: "vault" }),
    client.readContract({ address, abi: v2FactoryAbi, functionName: "locker" }),
    client.readContract({ address, abi: v2FactoryAbi, functionName: "hook" }),
    client.readContract({ address, abi: v2FactoryAbi, functionName: "launchAndBuy" }),
  ]);
  const v2CursorKey = `last_block:v2:${runtime.expectedChainId}:${address.toLowerCase()}`;
  const [state] = await db.select({ value: indexerState.value }).from(indexerState).where(eq(indexerState.key, v2CursorKey)).limit(1);
  let from = BigInt(state?.value || runtime.indexerStartBlock);
  const to = await client.getBlockNumber();
  while (from <= to) {
    const end = from + 999n < to ? from + 999n : to;
    const known = await db.select({ curve: tokens.curve, token: tokens.address }).from(tokens).where(eq(tokens.deployment, address));
    const logs = await collectV2Logs(client as unknown as Parameters<typeof collectV2Logs>[0], {
      factory: address, escrow, vault, locker, hook, wrapper,
      curves: known.flatMap((row) => row.curve ? [row.curve as `0x${string}`] : []),
    }, from, end);
    const times = await blockTimes(new Set(logs.map((log) => log.blockNumber)));
    const tokenByCurve = new Map(known.filter((row) => row.curve).map((row) => [row.curve!.toLowerCase(), row.token]));
    for (const log of logs) if (log.event === "LaunchCreated") tokenByCurve.set(log.args.curve.toLowerCase(), log.args.token);
    const applied = await db.transaction(async (tx) => {
      await tx.insert(indexerState).values({ key: v2CursorKey, value: runtime.indexerStartBlock.toString() }).onConflictDoNothing({ target: indexerState.key });
      const [current] = await tx.select({ value: indexerState.value }).from(indexerState).where(eq(indexerState.key, v2CursorKey)).for("update");
      if (BigInt(current.value) !== from) return false;
      for (const log of logs) {
        const { event, args } = log;
        const key = `${log.transactionHash}:${log.logIndex}`;
        if (event === "LaunchCreated") {
          await tx.insert(tokens).values({ address: args.token, deployment: address, curve: args.curve, name: args.name, symbol: args.symbol, creator: args.creator }).onConflictDoNothing({ target: tokens.address });
        } else if (event === "Trade") {
          await tx.insert(trades).values({
            eventKey: key, token: args.token, trader: args.trader, side: args.isBuy ? "buy" : "sell",
            quote: args.netTraderQuote.toString(), amount: args.tokenAmount.toString(),
            grossCurveQuote: args.grossCurveQuote.toString(), feeQuote: args.feeQuote.toString(), creatorTaxQuote: args.creatorTaxQuote.toString(),
            tx: log.transactionHash, blockNumber: log.blockNumber.toString(), blockTime: times.get(log.blockNumber)!,
          }).onConflictDoNothing({ target: trades.eventKey });
        } else if (event === "Graduated") {
          await tx.update(tokens).set({ graduated: true, pool: args.pool, quoteLiquidity: args.quoteLiquidity.toString(), updatedAt: new Date() }).where(eq(tokens.address, args.token));
        } else {
          const launch = event === "GraduationStarted" || event === "GraduationDeferred" || event === "PoolFeesRouted" || event === "PoolRegistered"
            ? args.token
            : event === "TokensRescued" || event === "NativeRescued"
              ? tokenByCurve.get(log.source.toLowerCase()) ?? zeroAddress
              : args.launch;
          await tx.insert(protocolEvents).values({
            eventKey: key, deployment: address, launch, kind: event,
            asset: args.asset ?? null, recipient: args.recipient ?? args.venue ?? args.pool ?? null,
            amount: (args.amount ?? args.quoteSpent)?.toString() ?? null,
            tx: log.transactionHash, blockNumber: log.blockNumber.toString(), blockTime: times.get(log.blockNumber)!,
          }).onConflictDoNothing({ target: protocolEvents.eventKey });
        }
      }
      await tx.update(indexerState).set({ value: (end + 1n).toString(), updatedAt: new Date() }).where(eq(indexerState.key, v2CursorKey));
      return true;
    });
    if (!applied) return;
    from = end + 1n;
  }
}
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

// Logs carry no timestamp, so resolve each distinct block once per batch. Trade
// rows without a real chain time would silently corrupt every 24h metric.
async function blockTimes(numbers: Set<bigint>) {
  const entries = await Promise.all(
    [...numbers].map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      return [blockNumber, new Date(Number(block.timestamp) * 1000)] as const;
    }),
  );
  return new Map(entries);
}

export async function indexToHead() {
  const chainId = await client.getChainId();
  if (chainId !== runtime.expectedChainId) {
    throw new Error(
      `Indexer RPC chain mismatch: expected ${runtime.expectedChainId}, received ${chainId}.`,
    );
  }
  if (runtime.contractVersion === "v2") return indexV2ToHead();
  if (runtime.expectedChainId === 4_153) {
    await Promise.all([
      client.readContract({ address: address!, abi: [parseAbiItem("function owner() view returns (address)")], functionName: "owner" }),
      client.readContract({ address: address!, abi: [parseAbiItem("function publicLaunchOpen() view returns (bool)")], functionName: "publicLaunchOpen" }),
      client.readContract({ address: address!, abi: [parseAbiItem("function totalReservedQuote() view returns (uint256)")], functionName: "totalReservedQuote" }),
    ]);
  }
  const [state] = await db
    .select({ value: indexerState.value })
    .from(indexerState)
    .where(eq(indexerState.key, cursorKey))
    .limit(1);
  let from = BigInt(state?.value || runtime.indexerStartBlock);
  const to = await client.getBlockNumber();
  while (from <= to) {
    const end = from + 999n < to ? from + 999n : to;
    // Fetch before acquiring the DB lock; a competing worker can discard this batch.
    const batches = await Promise.all(
      events.map(async (event) => ({
        event,
        logs: await client.getLogs({
          address,
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
          value: runtime.indexerStartBlock.toString(),
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
    if (!applied) return; // Another worker advanced the cursor; reread it next tick.
    from = end + 1n;
  }
}

let delay = 2000;
async function tick() {
  try {
    await indexToHead();
    delay = 2000;
  } catch (error) {
    console.error("indexer", error);
    delay = Math.min(delay * 2, 30000);
  }
  setTimeout(tick, delay);
}
if (import.meta.main) void tick();

import { eq } from "drizzle-orm";
import { createPublicClient, http, parseAbiItem } from "viem";
import { db } from "./db";
import { indexerState, tokens, trades } from "./db/schema";

const address = Bun.env.LAUNCHPAD_ADDRESS as `0x${string}` | undefined;
if (!address) {
  if (import.meta.main) {
    console.log("Indexer disabled: LAUNCHPAD_ADDRESS is not configured");
    process.exit(0);
  }
  throw new Error("LAUNCHPAD_ADDRESS is required");
}
if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
  throw new Error(
    "LAUNCHPAD_ADDRESS must be a contract address for the indexer",
  );
}
const client = createPublicClient({
  transport: http(Bun.env.RPC_URL || "http://127.0.0.1:8545"),
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

export async function indexToHead() {
  const [state] = await db
    .select({ value: indexerState.value })
    .from(indexerState)
    .where(eq(indexerState.key, "last_block"))
    .limit(1);
  let from = BigInt(state?.value || "0");
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
    const applied = await db.transaction(async (tx) => {
      await tx
        .insert(indexerState)
        .values({ key: "last_block", value: "0" })
        .onConflictDoNothing({ target: indexerState.key });
      const [current] = await tx
        .select({ value: indexerState.value })
        .from(indexerState)
        .where(eq(indexerState.key, "last_block"))
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
              })
              .onConflictDoNothing({ target: trades.eventKey });
          } else if (event.name === "Graduated") {
            await tx
              .update(tokens)
              .set({ graduated: true, pool: args.pool, updatedAt: new Date() })
              .where(eq(tokens.address, args.token));
          }
        }
      }
      await tx
        .update(indexerState)
        .set({ value: (end + 1n).toString(), updatedAt: new Date() })
        .where(eq(indexerState.key, "last_block"));
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

import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, parseAbi, toFunctionSelector } from "viem";
import { v2FactoryAbi } from "./sdk/v2Contracts";
import { v2CurveAbi } from "./sdk/v2Contracts";

const databaseUrl = Bun.env.TEST_DATABASE_URL;
const factory = getAddress("0x1111111111111111111111111111111111111111");
const token = getAddress("0x2222222222222222222222222222222222222222");
const curve = getAddress("0x3333333333333333333333333333333333333333");
const escrow = getAddress("0x4444444444444444444444444444444444444444");
const vault = getAddress("0x5555555555555555555555555555555555555555");
const locker = getAddress("0x6666666666666666666666666666666666666666");
const hook = getAddress("0x7777777777777777777777777777777777777777");
const wrapper = getAddress("0x8888888888888888888888888888888888888888");
const tx = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;

test.skipIf(!databaseUrl)("V2 indexer persists launch, same-block trade, and accrued fee", async () => {
  Bun.env.DATABASE_URL = databaseUrl;
  Bun.env.DATABASE_SSL = "false";
  const [{ db, closeDatabase }, schema] = await Promise.all([import("./db"), import("./db/schema")]);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const logs = [
    {
      address: factory,
      topics: encodeEventTopics({ abi: v2FactoryAbi, eventName: "LaunchCreated", args: { token, curve, creator: factory } }),
      data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }], ["NICO", "NICO", ""]),
      logIndex: "0x0",
    },
    {
      address: curve,
      topics: encodeEventTopics({ abi: v2CurveAbi, eventName: "Trade", args: { token, trader: factory } }),
      data: encodeAbiParameters([
        { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
      ], [true, 995n, 1000n, 5n, 0n, 10000n, 2000n, 3000n, 10000n]),
      logIndex: "0x1",
    },
    {
      address: escrow,
      topics: encodeEventTopics({ abi: parseAbi(["event FeeAccrued(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)"]), eventName: "FeeAccrued", args: { launch: token, asset: factory, recipient: factory } }),
      data: encodeAbiParameters([{ type: "uint256" }], [2n]),
      logIndex: "0x2",
    },
    {
      address: factory,
      topics: encodeEventTopics({ abi: parseAbi(["event GraduationDeferred(address indexed token,bytes reason)"]), eventName: "GraduationDeferred", args: { token } }),
      data: encodeAbiParameters([{ type: "bytes" }], ["0x"]),
      logIndex: "0x3",
    },
    {
      address: locker,
      topics: encodeEventTopics({ abi: parseAbi(["event PoolRegistered(address indexed pool,address indexed token,address indexed creator)"]), eventName: "PoolRegistered", args: { pool: curve, token, creator: factory } }),
      data: "0x",
      logIndex: "0x4",
    },
    {
      address: curve,
      topics: encodeEventTopics({ abi: parseAbi(["event TokensRescued(address indexed asset,uint256 amount,address indexed recipient)"]), eventName: "TokensRescued", args: { asset: factory, recipient: factory } }),
      data: encodeAbiParameters([{ type: "uint256" }], [7n]),
      logIndex: "0x5",
    },
    {
      address: factory,
      topics: encodeEventTopics({ abi: parseAbi(["event NativeRescued(uint256 amount,address indexed recipient)"]), eventName: "NativeRescued", args: { recipient: factory } }),
      data: encodeAbiParameters([{ type: "uint256" }], [9n]),
      logIndex: "0x6",
    },
  ].map((log) => ({ ...log, blockHash, blockNumber: "0x1", transactionHash: tx, transactionIndex: "0x0", removed: false }));
  const unfinalizedTrade = { ...logs[1], blockNumber: "0x2", transactionHash: `0x${"3".repeat(64)}` };
  logs.push(unfinalizedTrade);
  const services: Record<string, string> = { escrow, vault, locker, hook, launchAndBuy: wrapper };
  const rpc = Bun.serve({ port: 0, async fetch(request) {
    const input = await request.json();
    const reply = (call: { id: number; method: string; params: any[] }) => {
      let result: unknown;
      if (call.method === "eth_chainId") result = "0x7a69";
      else if (call.method === "eth_blockNumber") result = "0x2";
      else if (call.method === "eth_getLogs") {
        const filter = call.params[0];
        result = logs.filter((log) => log.address.toLowerCase() === filter.address?.toLowerCase() && log.topics[0].toLowerCase() === filter.topics?.[0]?.toLowerCase() && Number(log.blockNumber) >= Number(filter.fromBlock) && Number(log.blockNumber) <= Number(filter.toBlock));
      } else if (call.method === "eth_call") {
        const functionName = Object.keys(services).find((name) => call.params[0].data.startsWith(toFunctionSelector(`${name}()`)));
        if (!functionName) throw Error("Unexpected eth_call");
        result = encodeFunctionResult({ abi: v2FactoryAbi, functionName: functionName as "escrow" | "vault" | "locker" | "hook" | "launchAndBuy", result: services[functionName] as `0x${string}` });
      } else if (call.method === "eth_getBlockByNumber") result = { number: call.params[0] === "finalized" ? "0x1" : call.params[0], timestamp: "0x6aa00000", hash: blockHash, transactions: [] };
      else throw Error(`Unexpected RPC ${call.method}`);
      return { jsonrpc: "2.0", id: call.id, result };
    };
    return Response.json(Array.isArray(input) ? input.map(reply) : reply(input));
  } });
  Bun.env.CONTRACT_VERSION = "v2";
  Bun.env.LAUNCHPAD_ADDRESS = factory;
  Bun.env.RPC_URL = rpc.url.toString();
  Bun.env.EXPECTED_CHAIN_ID = "31337";
  Bun.env.INDEXER_START_BLOCK = "1";
  try {
    const { indexToHead } = await import("./indexer");
    await indexToHead();
    const [savedToken] = await db.select().from(schema.tokens).where(and(eq(schema.tokens.address, token), eq(schema.tokens.deployment, factory)));
    const [savedTrade] = await db.select().from(schema.trades).where(eq(schema.trades.eventKey, `${tx}:1`));
    const [savedFee] = await db.select().from(schema.protocolEvents).where(eq(schema.protocolEvents.eventKey, `${tx}:2`));
    expect(savedToken).toMatchObject({ curve, name: "NICO" });
    expect(savedTrade).toMatchObject({ quote: "1000", grossCurveQuote: "995", feeQuote: "5", creatorTaxQuote: "0" });
    const [prematureTrade] = await db.select().from(schema.trades).where(eq(schema.trades.eventKey, `${unfinalizedTrade.transactionHash}:1`));
    expect(prematureTrade).toBeUndefined();
    expect(savedFee).toMatchObject({ launch: token, kind: "FeeAccrued", amount: "2" });
    const lifecycle = await db.select().from(schema.protocolEvents).where(eq(schema.protocolEvents.deployment, factory));
    expect(lifecycle.map((event) => [event.kind, event.launch, event.amount]).sort()).toEqual([
      ["FeeAccrued", token, "2"],
      ["GraduationDeferred", token, null],
      ["NativeRescued", "0x0000000000000000000000000000000000000000", "9"],
      ["PoolRegistered", token, null],
      ["TokensRescued", token, "7"],
    ].sort());
  } finally {
    rpc.stop(true);
    await db.delete(schema.protocolEvents).where(eq(schema.protocolEvents.deployment, factory));
    await db.delete(schema.trades).where(eq(schema.trades.eventKey, `${tx}:1`));
    await db.delete(schema.tokens).where(and(eq(schema.tokens.address, token), eq(schema.tokens.deployment, factory)));
    await db.delete(schema.indexerState).where(eq(schema.indexerState.key, `last_block:v2:31337:${factory.toLowerCase()}`));
    await closeDatabase();
  }
}, 30_000);

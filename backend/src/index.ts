import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, http, parseAbiItem } from "viem";
const db = new Database(Bun.env.DATABASE_PATH || "curveball.sqlite");
db.exec(
    "CREATE TABLE IF NOT EXISTS tokens(address TEXT PRIMARY KEY,name TEXT,symbol TEXT,creator TEXT,graduated INTEGER DEFAULT 0,pool TEXT);CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE,token TEXT,trader TEXT,side TEXT,quote TEXT,amount TEXT,tx TEXT);CREATE TABLE IF NOT EXISTS indexer_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
);
const app = new Hono();
app.use("/*", cors({ origin: Bun.env.CORS_ORIGIN || "http://localhost:5173" }));
app.get("/health", (c) => c.json({ ok: true }));
app.get("/tokens", (c) =>
    c.json(db.prepare("SELECT * FROM tokens ORDER BY graduated DESC").all()),
);
app.get("/tokens/:address", (c) => {
    const x = db
        .prepare("SELECT * FROM tokens WHERE address=?")
        .get(c.req.param("address"));
    return x ? c.json(x) : c.json({ error: "not found" }, 404);
});
app.get("/tokens/:address/transactions", (c) =>
    c.json(
        db
            .prepare("SELECT * FROM trades WHERE token=? ORDER BY id DESC")
            .all(c.req.param("address")),
    ),
);
app.get("/tokens/:address/graduation", (c) => {
    const x = db
        .prepare("SELECT graduated,pool FROM tokens WHERE address=?")
        .get(c.req.param("address"));
    return x ? c.json(x) : c.json({ error: "not found" }, 404);
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
            let from = BigInt(
                (
                    db
                        .prepare("SELECT value FROM indexer_state WHERE key='last_block'")
                        .get() as any
                )?.value || "0",
            ),
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
                            db.prepare(
                                "INSERT OR IGNORE INTO tokens(address,name,symbol,creator) VALUES(?,?,?,?)",
                            ).run(a.token, a.name, a.symbol, a.creator);
                        if (event.name === "Trade")
                            db.prepare(
                                "INSERT OR IGNORE INTO trades(event_key,token,trader,side,quote,amount,tx) VALUES(?,?,?,?,?,?,?)",
                            ).run(
                                key,
                                a.token,
                                a.trader,
                                a.isBuy ? "buy" : "sell",
                                a.quoteAmount.toString(),
                                a.tokenAmount.toString(),
                                log.transactionHash,
                            );
                        if (event.name === "Graduated")
                            db.prepare(
                                "UPDATE tokens SET graduated=1,pool=? WHERE address=?",
                            ).run(a.pool, a.token);
                    }
                db.prepare(
                    "INSERT OR REPLACE INTO indexer_state VALUES('last_block',?)",
                ).run((end + 1n).toString());
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

import { Database } from "bun:sqlite";
const db = new Database(Bun.env.DATABASE_PATH || "curveball.sqlite");
db.exec(
    "CREATE TABLE IF NOT EXISTS tokens(address TEXT PRIMARY KEY,name TEXT,symbol TEXT,creator TEXT,graduated INTEGER DEFAULT 0,pool TEXT)",
);
db.prepare("INSERT OR IGNORE INTO tokens VALUES(?,?,?,?,?,?)").run(
    "0x000000000000000000000000000000000000c0de",
    "Curveball",
    "CURVE",
    "local",
    0,
    null,
);
console.log("seeded");

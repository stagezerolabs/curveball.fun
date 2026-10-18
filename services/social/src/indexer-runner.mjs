import { pool } from "./db.mjs";
import { startIndexer } from "./indexer.mjs";

const stop = startIndexer({ onError: (error) => console.error("Curveball indexer error", error) });

async function shutdown(signal) {
  console.log(`Received ${signal}; stopping Curveball indexer.`);
  stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

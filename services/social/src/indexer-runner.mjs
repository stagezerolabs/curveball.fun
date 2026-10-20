import { pool } from "./db.mjs";
import { startIndexer } from "./indexer.mjs";
import { captureBackendException, flushBackendEvents } from "./instrument.mjs";

const stop = startIndexer({ onError: (error) => {
  captureBackendException(error, "indexer");
  console.error("Curveball indexer error", error);
} });

async function shutdown(signal) {
  console.log(`Received ${signal}; stopping Curveball indexer.`);
  stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await pool.end();
  await flushBackendEvents();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

import { pool } from "./db.mjs";
import { startMetadataWorker } from "./metadata.mjs";

const stop = startMetadataWorker({ onError: (error) => console.error("Curveball worker error", error) });

async function shutdown(signal) {
  console.log(`Received ${signal}; stopping Curveball worker.`);
  stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

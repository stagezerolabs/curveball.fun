import { pool } from "./db.mjs";
import { startMetadataWorker } from "./metadata.mjs";
import { captureBackendException, flushBackendEvents } from "./instrument.mjs";

const stop = startMetadataWorker({ onError: (error) => {
  captureBackendException(error, "worker");
  console.error("Curveball worker error", error);
} });

async function shutdown(signal) {
  console.log(`Received ${signal}; stopping Curveball worker.`);
  stop();
  await pool.end();
  await flushBackendEvents();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

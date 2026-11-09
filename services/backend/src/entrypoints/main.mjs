import { EventEmitter } from "node:events";
import { config } from "../platform/config.mjs";
import { pool } from "../platform/db.mjs";
import { startIndexer } from "../indexing/indexer.mjs";
import { startMetadataWorker } from "../workers/metadata.mjs";
import { createSocialServer } from "../api/server.mjs";
import { registerWebRoutes } from "../web/routes.mjs";
import { captureBackendException, flushBackendEvents } from "../platform/instrument.mjs";

const events = new EventEmitter();
events.setMaxListeners(1_000);

const server = createSocialServer({
  subscribe(listener) {
    events.on("social", listener);
    return () => events.off("social", listener);
  },
});
await registerWebRoutes(server);

const stopIndexer = startIndexer({
  onEvent: (event) => events.emit("social", event),
  onError: (error) => {
    captureBackendException(error, "indexer");
    console.error("Social indexer error", error);
  },
});
const stopMetadataWorker = startMetadataWorker({
  onError: (error) => {
    captureBackendException(error, "worker");
    console.error("Metadata worker error", error);
  },
});

await server.listen({ port: config.port, host: "0.0.0.0" });
console.log(`Curveball backend listening on :${config.port}`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping backend.`);
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  try {
    stopIndexer();
    stopMetadataWorker();
    server.closeEventStreams();
    await server.close();
    await pool.end();
    await flushBackendEvents();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    captureBackendException(error, "shutdown");
    console.error("Backend shutdown failed", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

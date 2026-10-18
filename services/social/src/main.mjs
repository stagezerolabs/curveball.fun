import { EventEmitter } from "node:events";
import { config } from "./config.mjs";
import { pool } from "./db.mjs";
import { startIndexer } from "./indexer.mjs";
import { startMetadataWorker } from "./metadata.mjs";
import { createSocialServer } from "./server.mjs";

const events = new EventEmitter();
events.setMaxListeners(1_000);

const server = createSocialServer({
  subscribe(listener) {
    events.on("social", listener);
    return () => events.off("social", listener);
  },
});

const stopIndexer = startIndexer({
  onEvent: (event) => events.emit("social", event),
  onError: (error) => console.error("Social indexer error", error),
});
const stopMetadataWorker = startMetadataWorker({
  onError: (error) => console.error("Metadata worker error", error),
});

server.listen(config.port, () => {
  console.log(`Curveball social service listening on :${config.port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; stopping social service.`);
  stopIndexer();
  stopMetadataWorker();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

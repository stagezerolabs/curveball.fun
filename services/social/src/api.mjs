import { config } from "./config.mjs";
import { pool } from "./db.mjs";
import { createSocialServer } from "./server.mjs";

const server = createSocialServer();
server.listen(config.port, () => console.log(`Curveball API listening on :${config.port}`));

async function shutdown(signal) {
  console.log(`Received ${signal}; stopping Curveball API.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

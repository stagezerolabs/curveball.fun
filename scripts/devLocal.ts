import { createServer } from "node:net";
import postgres from "postgres";
import { assertLocalV2MigrationTarget } from "./localV2Migration";

assertLocalV2MigrationTarget(Bun.env);

const sql = postgres(Bun.env.DATABASE_URL!, { prepare: false });
try {
  await sql`select "deployment" from "tokens" limit 0`;
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "42703") {
    throw new Error("The local database is missing V2 columns. Run make migrate-v2-local before starting dev.");
  }
  throw error;
} finally {
  await sql.end();
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

const requestedPort = Bun.env.PORT ? Number(Bun.env.PORT) : null;
if (requestedPort !== null && (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535)) {
  throw new Error("PORT must be a valid TCP port.");
}
let port = requestedPort ?? 3001;
while (!(await portAvailable(port))) {
  if (requestedPort !== null || port >= 3010) throw new Error(`API port ${port} is already in use. Choose an available PORT.`);
  port += 1;
}
if (port !== 3001) console.log(`Local API port 3001 is busy; using ${port}.`);

const env = { ...Bun.env, PORT: String(port), API_URL: `http://127.0.0.1:${port}` };
const options = { env, stdin: "inherit" as const, stdout: "inherit" as const, stderr: "inherit" as const };
const api = Bun.spawn(["bun", "run", "dev:api"], options);
const web = Bun.spawn(["bun", "run", "dev:web"], options);

const stop = () => {
  api.kill();
  web.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const first = await Promise.race([api.exited, web.exited]);
stop();
process.exitCode = first;

import { defineConfig } from "drizzle-kit";
import { expectedChainId } from "./src/expectedChainId";

const mainnet = expectedChainId(process.env.EXPECTED_CHAIN_ID, 11_155_931) === 4_153;
const url = mainnet ? process.env.MAINNET_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(mainnet ? "MAINNET_DATABASE_URL is required" : "DATABASE_URL is required");
if (mainnet && url === process.env.DATABASE_URL) throw new Error("Mainnet and testnet databases must be separate.");
const sslUrl =
  process.env.DATABASE_SSL === "true" && !/[?&]sslmode=/.test(url)
    ? `${url}${url.includes("?") ? "&" : "?"}sslmode=require`
    : url;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: sslUrl },
  strict: true,
  verbose: true,
});

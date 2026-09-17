import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sslUrl =
  process.env.DATABASE_SSL === "true"
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

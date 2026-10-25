import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SOCIAL_DATABASE_CA_FILE is resolved relative to services/social, so the same value works locally and in Docker.
export function databaseSsl() {
  if (process.env.SOCIAL_DATABASE_SSL !== "true") return undefined;
  const caFile = (process.env.SOCIAL_DATABASE_CA_FILE || "").trim();
  if (!caFile) return { rejectUnauthorized: true };
  return {
    rejectUnauthorized: true,
    ca: readFileSync(
      fileURLToPath(new URL(caFile, new URL("../", import.meta.url))),
      "utf8",
    ),
  };
}

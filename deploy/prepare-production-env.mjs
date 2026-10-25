import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function parseEnv(path) {
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim();
  }
  return values;
}

function requireValue(values, key, source) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`${key} is missing from ${source}.`);
  if (/[\r\n]/.test(value)) throw new Error(`${key} contains a newline.`);
  return value;
}

function writeEnv(path, entries) {
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}.`);
  const source = `${entries
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
  writeFileSync(path, source, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const frontendSource = ".env";
const socialSource = "services/social/.env";
const keeperSource = "keeper/.env";
const frontend = parseEnv(resolve(root, frontendSource));
const social = parseEnv(resolve(root, socialSource));
const keeper = parseEnv(resolve(root, keeperSource));
const deployment = JSON.parse(
  readFileSync(resolve(root, "deployments/11155931/curveball.json"), "utf8"),
);

const chainId = String(deployment.chainId);
const launchpad = String(deployment.launchpad);
const deploymentBlock = String(deployment.deploymentBlock);
const parity = [
  [frontend.VITE_CHAIN_ID, frontend.VITE_LAUNCHPAD_ADDRESS, frontend.VITE_DEPLOYMENT_BLOCK],
  [social.SOCIAL_CHAIN_ID, social.SOCIAL_LAUNCHPAD_ADDRESS, social.SOCIAL_DEPLOYMENT_BLOCK],
  [keeper.KEEPER_CHAIN_ID, keeper.KEEPER_LAUNCHPAD_ADDRESS, keeper.KEEPER_DEPLOYMENT_BLOCK],
].every(
  ([configuredChain, configuredLaunchpad, configuredBlock]) =>
    configuredChain === chainId &&
    configuredLaunchpad?.toLowerCase() === launchpad.toLowerCase() &&
    configuredBlock === deploymentBlock,
);
if (!parity) throw new Error("Source environments do not match the recorded testnet deployment.");

const gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const release = `testnet-${gitCommit}${dirty ? "-wip" : ""}-${timestamp}`;
const adminAddress =
  social.SOCIAL_ADMIN_ADDRESS ||
  frontend.VITE_ADMIN_ADDRESS ||
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";

writeEnv(resolve(root, "deploy/production.env"), [
  ["CURVEBALL_RELEASE", release],
  ["CURVEBALL_DB_PASSWORD", randomBytes(32).toString("base64url")],
  ["VITE_CHAIN_ID", chainId],
  ["VITE_RPC_URL", requireValue(frontend, "VITE_RPC_URL", frontendSource)],
  ["VITE_LAUNCHPAD_ADDRESS", launchpad],
  ["VITE_DEPLOYMENT_BLOCK", deploymentBlock],
  ["VITE_PRIVY_APP_ID", requireValue(frontend, "VITE_PRIVY_APP_ID", frontendSource)],
  ["VITE_PRIVY_CLIENT_ID", frontend.VITE_PRIVY_CLIENT_ID],
  ["VITE_SOCIAL_API_URL", "https://social-api.curveball.fun"],
  ["VITE_ADMIN_ADDRESS", adminAddress],
]);

writeEnv(resolve(root, "deploy/social.env"), [
  ["SOCIAL_RPC_URL", requireValue(social, "SOCIAL_RPC_URL", socialSource)],
  ["SOCIAL_CHAIN_ID", chainId],
  ["SOCIAL_CHAIN_NAME", "RISE Testnet"],
  ["SOCIAL_NATIVE_SYMBOL", social.SOCIAL_NATIVE_SYMBOL || "ETH"],
  ["SOCIAL_LAUNCHPAD_ADDRESS", launchpad],
  ["SOCIAL_ADMIN_ADDRESS", adminAddress],
  ["SOCIAL_PROTOCOL_ACCOUNTS", social.SOCIAL_PROTOCOL_ACCOUNTS],
  ["SOCIAL_DEPLOYMENT_BLOCK", deploymentBlock],
  ["SOCIAL_PORT", social.SOCIAL_PORT || "8787"],
  ["SOCIAL_ALLOWED_ORIGINS", "https://curveball.fun"],
  ["SOCIAL_PUBLIC_ORIGIN", "https://social-api.curveball.fun"],
  ["PRIVY_APP_ID", requireValue(social, "PRIVY_APP_ID", socialSource)],
  ["PRIVY_APP_SECRET", requireValue(social, "PRIVY_APP_SECRET", socialSource)],
  ["SOCIAL_CONFIRMATIONS", social.SOCIAL_CONFIRMATIONS || "2"],
  ["SOCIAL_POLL_INTERVAL_MS", social.SOCIAL_POLL_INTERVAL_MS || "3000"],
  ["SOCIAL_LOG_RANGE", social.SOCIAL_LOG_RANGE || "2000"],
  ["SOCIAL_METADATA_REFRESH_MS", social.SOCIAL_METADATA_REFRESH_MS || "300000"],
  ["SOCIAL_IPFS_GATEWAY", social.SOCIAL_IPFS_GATEWAY],
  ["SOCIAL_METADATA_HOSTS", social.SOCIAL_METADATA_HOSTS],
  ["SOCIAL_RNS_API_URL", social.SOCIAL_RNS_API_URL],
  ["SOCIAL_DB_POOL_SIZE", social.SOCIAL_DB_POOL_SIZE || "10"],
  ["SENTRY_DSN", social.SENTRY_DSN],
  ["SENTRY_ENVIRONMENT", "production"],
  ["SENTRY_RELEASE", `curveball-backend@${release}`],
  ["SENTRY_TRACES_SAMPLE_RATE", social.SENTRY_TRACES_SAMPLE_RATE || "0.1"],
]);

writeEnv(resolve(root, "deploy/keeper.env"), [
  ["KEEPER_CHAIN_ID", chainId],
  ["KEEPER_RPC_URL", requireValue(keeper, "KEEPER_RPC_URL", keeperSource)],
  ["KEEPER_LAUNCHPAD_ADDRESS", launchpad],
  ["KEEPER_DEPLOYMENT_BLOCK", deploymentBlock],
  ["KEEPER_PRIVATE_KEY", requireValue(keeper, "KEEPER_PRIVATE_KEY", keeperSource)],
  ["KEEPER_POLL_INTERVAL_MS", keeper.KEEPER_POLL_INTERVAL_MS || "10000"],
  ["SENTRY_DSN", keeper.SENTRY_DSN],
  ["SENTRY_ENVIRONMENT", "production"],
  ["SENTRY_RELEASE", `curveball-keeper@${release}`],
  ["SENTRY_TRACES_SAMPLE_RATE", keeper.SENTRY_TRACES_SAMPLE_RATE || "0.1"],
]);

writeEnv(resolve(root, "deploy/web.env"), [
  ["PINATA_JWT", requireValue(frontend, "PINATA_JWT", frontendSource)],
]);

console.log(`Prepared ignored production environments for ${release}.`);

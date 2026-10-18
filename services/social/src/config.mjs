import { getAddress, isAddress } from "viem";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function protocolAccounts(value) {
  if (!value?.trim()) return [];
  return value.split(",").map((entry) => {
    const [rawRole, rawAddress] = entry.includes("=") ? entry.split("=", 2) : ["system", entry];
    const role = rawRole.trim().toLowerCase();
    const address = rawAddress?.trim();
    if (!role || !address || !isAddress(address)) throw new Error("SOCIAL_PROTOCOL_ACCOUNTS must contain role=address pairs.");
    return { role, address: getAddress(address).toLowerCase() };
  });
}

function metadataConfiguration() {
  const gateway = process.env.SOCIAL_IPFS_GATEWAY?.trim() || "https://gateway.pinata.cloud/ipfs/";
  let parsed;
  try {
    parsed = new URL(gateway);
  } catch {
    throw new Error("SOCIAL_IPFS_GATEWAY must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("SOCIAL_IPFS_GATEWAY must use HTTPS.");
  const hosts = new Set((process.env.SOCIAL_METADATA_HOSTS || parsed.hostname)
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  hosts.add(parsed.hostname.toLowerCase());
  return { gateway: gateway.endsWith("/") ? gateway : `${gateway}/`, hosts };
}

// SOCIAL_FACTORY_ADDRESS is the pre-launchpad name, still accepted so existing env files keep working.
const launchpad = process.env.SOCIAL_LAUNCHPAD_ADDRESS?.trim() || process.env.SOCIAL_FACTORY_ADDRESS?.trim();
if (!launchpad) throw new Error("SOCIAL_LAUNCHPAD_ADDRESS is required.");
if (!isAddress(launchpad)) throw new Error("SOCIAL_LAUNCHPAD_ADDRESS is invalid.");
const admin = process.env.SOCIAL_ADMIN_ADDRESS?.trim() || "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
if (!isAddress(admin)) throw new Error("SOCIAL_ADMIN_ADDRESS is invalid.");
const metadata = metadataConfiguration();
const rnsApiUrl = process.env.SOCIAL_RNS_API_URL?.trim() || "https://api.stage0.xyz/api/public/rns/resolve/address/";
if (!rnsApiUrl.startsWith("https://")) throw new Error("SOCIAL_RNS_API_URL must use HTTPS.");

export const config = Object.freeze({
  databaseUrl: required("SOCIAL_DATABASE_URL"),
  directDatabaseUrl: process.env.SOCIAL_DIRECT_DATABASE_URL?.trim() || process.env.SOCIAL_DATABASE_URL?.trim(),
  rpcUrl: process.env.SOCIAL_RPC_URL?.trim() || "https://rpc.risechain.com",
  chainId: positiveInteger("SOCIAL_CHAIN_ID", 4153),
  chainName: process.env.SOCIAL_CHAIN_NAME?.trim() || "Rise",
  nativeSymbol: process.env.SOCIAL_NATIVE_SYMBOL?.trim() || "ETH",
  launchpadAddress: getAddress(launchpad),
  adminAddress: getAddress(admin).toLowerCase(),
  protocolAccounts: protocolAccounts(process.env.SOCIAL_PROTOCOL_ACCOUNTS),
  deploymentBlock: BigInt(required("SOCIAL_DEPLOYMENT_BLOCK")),
  port: positiveInteger("SOCIAL_PORT", 8787),
  publicOrigin: process.env.SOCIAL_PUBLIC_ORIGIN?.trim() || "http://localhost:8787",
  allowedOrigins: new Set((process.env.SOCIAL_ALLOWED_ORIGINS || "http://localhost:5173")
    .split(",").map((value) => value.trim()).filter(Boolean)),
  privyAppId: required("PRIVY_APP_ID"),
  privyAppSecret: required("PRIVY_APP_SECRET"),
  confirmations: BigInt(positiveInteger("SOCIAL_CONFIRMATIONS", 2)),
  pollIntervalMs: positiveInteger("SOCIAL_POLL_INTERVAL_MS", 3_000),
  logRange: BigInt(positiveInteger("SOCIAL_LOG_RANGE", 2_000)),
  metadataRefreshMs: positiveInteger("SOCIAL_METADATA_REFRESH_MS", 300_000),
  ipfsGateway: metadata.gateway,
  metadataHosts: metadata.hosts,
  rnsApiUrl: rnsApiUrl.endsWith("/") ? rnsApiUrl : `${rnsApiUrl}/`,
});

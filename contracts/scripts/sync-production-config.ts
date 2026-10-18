export {};

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const isTestnet = requestedNetwork === "testnet";
const chainId = isTestnet ? 11_155_931 : 4_153;
const recordPath = isTestnet ? "deployments/11155931/curveball.json" : "deployments/4153/curveball.json";
// Testnet writes only this worktree's local env files, never the main checkout's shared `.env`,
// so a checkout still running against another deployment keeps working.
const path = isTestnet ? ".env.local" : ".env.production";
const record = await Bun.file(recordPath).json() as {
  chainId: number;
  launchpad: string;
  deploymentBlock: string;
};
if (record.chainId !== chainId || !/^0x[0-9a-fA-F]{40}$/.test(record.launchpad) || !/^\d+$/.test(record.deploymentBlock)) {
  throw new Error(`Invalid RISE ${requestedNetwork} deployment record.`);
}

let source = await Bun.file(path).exists() ? await Bun.file(path).text() : "";
const values = {
  VITE_CHAIN_ID: String(record.chainId),
  ...(isTestnet ? { VITE_RPC_URL: "https://testnet.riselabs.xyz" } : {}),
  VITE_LAUNCHPAD_ADDRESS: record.launchpad,
  VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
};
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  source = new RegExp(`^${key}=.*$`, "m").test(source)
    ? source.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${source.trimEnd() ? `${source.trimEnd()}\n` : ""}${line}\n`;
}
source = source.replace(/^VITE_FACTORY_VERSION=.*(?:\r?\n|$)/m, "");
await Bun.write(path, source);
if (isTestnet) await Bun.write(".env.testnet.local", source);
console.log(`Updated ${path} for RISE ${requestedNetwork} launchpad ${record.launchpad} at block ${record.deploymentBlock}.`);
if (isTestnet) console.log("Updated this worktree's local development and testnet-build environments only.");

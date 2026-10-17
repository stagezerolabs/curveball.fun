import { dirname, resolve } from "node:path";

export {};

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const isTestnet = requestedNetwork === "testnet";
const chainId = isTestnet ? 11_155_931 : 4_153;
const recordPath = isTestnet ? "deployments/11155931/curveball.json" : "deployments/4153/curveball.json";
const commonGitDirectory = Bun.spawnSync([
  "git",
  "rev-parse",
  "--path-format=absolute",
  "--git-common-dir",
]).stdout.toString().trim();
const path = isTestnet ? resolve(dirname(commonGitDirectory), ".env") : ".env.production";
const record = await Bun.file(recordPath).json() as {
  chainId: number;
  factory: string;
  deploymentBlock: string;
};
if (record.chainId !== chainId || !/^0x[0-9a-fA-F]{40}$/.test(record.factory) || !/^\d+$/.test(record.deploymentBlock)) {
  throw new Error(`Invalid RISE ${requestedNetwork} deployment record.`);
}

let source = await Bun.file(path).text();
const values = {
  VITE_CHAIN_ID: String(record.chainId),
  ...(isTestnet ? { VITE_RPC_URL: "https://testnet.riselabs.xyz" } : {}),
  VITE_LAUNCHPAD_ADDRESS: record.factory,
  VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
};
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  source = new RegExp(`^${key}=.*$`, "m").test(source)
    ? source.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${source.trimEnd()}\n${line}\n`;
}
source = source.replace(/^VITE_FACTORY_VERSION=.*(?:\r?\n|$)/m, "");
await Bun.write(path, source);
if (isTestnet) {
  await Promise.all([
    Bun.write(".env.local", source),
    Bun.write(".env.testnet.local", source),
  ]);
}
console.log(`Updated ${path} for RISE ${requestedNetwork} factory ${record.factory} at block ${record.deploymentBlock}.`);
if (isTestnet) console.log("Updated this worktree's local development and testnet-build environments.");

export {};

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const isTestnet = requestedNetwork === "testnet";
const chainId = isTestnet ? 11_155_931 : 4_153;
const recordPath = `deployments/${chainId}/curveball-oracle-v3.json`;
const record = (await Bun.file(recordPath).json()) as {
  version: string;
  chainId: number;
  launchpad: string;
  deploymentBlock: string;
  sourceTreeSha256?: string;
};
if (
  record.version !== "oracle-v3" ||
  record.chainId !== chainId ||
  !/^0x[0-9a-fA-F]{40}$/.test(record.launchpad) ||
  !/^\d+$/.test(record.deploymentBlock)
) {
  throw new Error(`Invalid RISE ${requestedNetwork} oracle deployment record.`);
}

const swapRecordPath = `deployments/${chainId}/icarus-swap-adapter-oracle-v3.json`;
const swapRecord = (await Bun.file(swapRecordPath).json()) as {
  chainId: number;
  launchpad: string;
  adapter: string;
  codeHash: string;
};
if (
  swapRecord.chainId !== chainId ||
  swapRecord.launchpad.toLowerCase() !== record.launchpad.toLowerCase() ||
  !/^0x[0-9a-fA-F]{40}$/.test(swapRecord.adapter) ||
  !/^0x[0-9a-fA-F]{64}$/.test(swapRecord.codeHash)
) {
  throw new Error(`Invalid RISE ${requestedNetwork} swap adapter record.`);
}

const frontendValues = {
  VITE_CHAIN_ID: String(chainId),
  ...(isTestnet ? { VITE_RPC_URL: "https://testnet.riselabs.xyz" } : {}),
  VITE_LAUNCHPAD_ADDRESS: record.launchpad,
  VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
  VITE_ICARUS_SWAP_ADAPTER: swapRecord.adapter,
  VITE_ICARUS_SWAP_ADAPTER_CODE_HASH: swapRecord.codeHash,
};
const socialValues = {
  SOCIAL_CHAIN_ID: String(chainId),
  SOCIAL_LAUNCHPAD_ADDRESS: record.launchpad,
  SOCIAL_DEPLOYMENT_BLOCK: record.deploymentBlock,
};
const keeperValues = {
  KEEPER_CHAIN_ID: String(chainId),
  KEEPER_LAUNCHPAD_ADDRESS: record.launchpad,
  KEEPER_DEPLOYMENT_BLOCK: record.deploymentBlock,
};
const release = `${requestedNetwork}-oracle-v3-${record.launchpad.slice(2, 10).toLowerCase()}`;
const obsolete =
  /^(?:VITE_LAUNCH_FEE_MODE|SOCIAL_LAUNCH_FEE_MODE|VITE_LEGACY_[A-Z_]+|SOCIAL_LEGACY_LAUNCHPADS|KEEPER_LEGACY_LAUNCHPADS|VITE_FACTORY_VERSION)=.*(?:\r?\n|$)/gm;
async function updateEnv(path: string, entries: Record<string, string>) {
  let source = (await Bun.file(path).exists())
    ? await Bun.file(path).text()
    : "";
  source = source.replace(obsolete, "");
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    source = new RegExp(`^${key}=.*$`, "m").test(source)
      ? source.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${source.trimEnd() ? `${source.trimEnd()}\n` : ""}${line}\n`;
  }
  await Bun.write(path, source);
  console.log(
    `Updated ${path} for RISE ${requestedNetwork} launchpad ${record.launchpad}.`,
  );
}

if (isTestnet) {
  await updateEnv(".env", {
    ...frontendValues,
    ...socialValues,
    ...keeperValues,
  });
} else {
  await updateEnv(".env.production", frontendValues);
  if (await Bun.file("services/backend/.env.mainnet.local").exists())
    await updateEnv("services/backend/.env.mainnet.local", socialValues);
  if (await Bun.file("keeper/.env.mainnet.local").exists())
    await updateEnv("keeper/.env.mainnet.local", keeperValues);
}
for (const [path, entries] of [
  ["deploy/production.env", { ...frontendValues, CURVEBALL_RELEASE: release }],
  [
    "deploy/social.env",
    { ...socialValues, SENTRY_RELEASE: `curveball-backend@${release}` },
  ],
  [
    "deploy/keeper.env",
    { ...keeperValues, SENTRY_RELEASE: `curveball-keeper@${release}` },
  ],
  ["deploy/web.env", frontendValues],
] as const) {
  if (await Bun.file(path).exists()) await updateEnv(path, entries);
}

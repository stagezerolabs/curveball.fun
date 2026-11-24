export {};

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const isTestnet = requestedNetwork === "testnet";
const oracleRelease = Bun.env.DEPLOYMENT_FEE_MODE === "oracle";
const chainId = isTestnet ? 11_155_931 : 4_153;
const recordPath = `deployments/${chainId}/${oracleRelease ? "curveball-oracle-v3.json" : "curveball.json"}`;
const record = (await Bun.file(recordPath).json()) as {
  chainId: number;
  launchpad: string;
  deploymentBlock: string;
  sourceTreeSha256?: string;
};
if (
  record.chainId !== chainId ||
  !/^0x[0-9a-fA-F]{40}$/.test(record.launchpad) ||
  !/^\d+$/.test(record.deploymentBlock)
) {
  throw new Error(`Invalid RISE ${requestedNetwork} deployment record.`);
}

const swapRecordPath = `deployments/${chainId}/${oracleRelease ? "icarus-swap-adapter-oracle-v3.json" : "icarus-swap-adapter.json"}`;
let swapAdapter = "";
let swapAdapterCodeHash = "";
if (await Bun.file(swapRecordPath).exists()) {
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
  swapAdapter = swapRecord.adapter;
  swapAdapterCodeHash = swapRecord.codeHash;
}

const values = {
  VITE_CHAIN_ID: String(record.chainId),
  ...(isTestnet ? { VITE_RPC_URL: "https://testnet.riselabs.xyz" } : {}),
  VITE_LAUNCHPAD_ADDRESS: record.launchpad,
  VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
  VITE_LAUNCH_FEE_MODE: oracleRelease ? "oracle" : "fixed",
  VITE_ICARUS_SWAP_ADAPTER: swapAdapter,
  VITE_ICARUS_SWAP_ADAPTER_CODE_HASH: swapAdapterCodeHash,
};
const legacyRecord = oracleRelease && !isTestnet
  ? await Bun.file(`deployments/${chainId}/curveball.json`).json() as { launchpad: string; deploymentBlock: string }
  : null;
const legacyAdapter = oracleRelease && !isTestnet
  ? await Bun.file(`deployments/${chainId}/icarus-swap-adapter.json`).json() as { adapter: string; codeHash: string }
  : null;
const releaseValues = {
  ...values,
  VITE_LEGACY_LAUNCHPAD_ADDRESS: legacyRecord?.launchpad ?? "",
  VITE_LEGACY_DEPLOYMENT_BLOCK: legacyRecord?.deploymentBlock ?? "",
  VITE_LEGACY_ICARUS_SWAP_ADAPTER: legacyAdapter?.adapter ?? "",
  VITE_LEGACY_ICARUS_SWAP_ADAPTER_CODE_HASH: legacyAdapter?.codeHash ?? "",
};
async function updateEnv(path: string, entries: Record<string, string>) {
  let source = (await Bun.file(path).exists())
    ? await Bun.file(path).text()
    : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    source = new RegExp(`^${key}=.*$`, "m").test(source)
      ? source.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${source.trimEnd() ? `${source.trimEnd()}\n` : ""}${line}\n`;
  }
  source = source.replace(/^VITE_FACTORY_VERSION=.*(?:\r?\n|$)/m, "");
  await Bun.write(path, source);
  console.log(
    `Updated ${path} for RISE ${requestedNetwork} launchpad ${record.launchpad}.`,
  );
}

if (isTestnet) {
  await updateEnv(".env", {
    ...releaseValues,
    SOCIAL_CHAIN_ID: String(chainId),
    SOCIAL_LAUNCHPAD_ADDRESS: record.launchpad,
    SOCIAL_LAUNCH_FEE_MODE: oracleRelease ? "oracle" : "fixed",
    SOCIAL_LEGACY_LAUNCHPADS: legacyRecord ? `${legacyRecord.launchpad}:${legacyRecord.deploymentBlock}` : "",
    SOCIAL_DEPLOYMENT_BLOCK: record.deploymentBlock,
    KEEPER_CHAIN_ID: String(chainId),
    KEEPER_LAUNCHPAD_ADDRESS: record.launchpad,
    KEEPER_LEGACY_LAUNCHPADS: legacyRecord ? `${legacyRecord.launchpad}:${legacyRecord.deploymentBlock}` : "",
    KEEPER_DEPLOYMENT_BLOCK: record.deploymentBlock,
  });
  const release = `testnet-${(record.sourceTreeSha256 ?? record.launchpad).slice(2, 14)}-${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "Z")}`;
  if (await Bun.file("deploy/production.env").exists()) {
    await updateEnv("deploy/production.env", {
      CURVEBALL_RELEASE: release,
      VITE_CHAIN_ID: String(chainId),
      VITE_LAUNCHPAD_ADDRESS: record.launchpad,
      VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
      VITE_ICARUS_SWAP_ADAPTER: swapAdapter,
      VITE_ICARUS_SWAP_ADAPTER_CODE_HASH: swapAdapterCodeHash,
      VITE_LAUNCH_FEE_MODE: oracleRelease ? "oracle" : "fixed",
      VITE_LEGACY_LAUNCHPAD_ADDRESS: legacyRecord?.launchpad ?? "",
      VITE_LEGACY_DEPLOYMENT_BLOCK: legacyRecord?.deploymentBlock ?? "",
      VITE_LEGACY_ICARUS_SWAP_ADAPTER: legacyAdapter?.adapter ?? "",
      VITE_LEGACY_ICARUS_SWAP_ADAPTER_CODE_HASH: legacyAdapter?.codeHash ?? "",
    });
  }
  if (await Bun.file("deploy/social.env").exists()) {
    await updateEnv("deploy/social.env", {
      SOCIAL_CHAIN_ID: String(chainId),
      SOCIAL_LAUNCHPAD_ADDRESS: record.launchpad,
      SOCIAL_LAUNCH_FEE_MODE: oracleRelease ? "oracle" : "fixed",
      SOCIAL_LEGACY_LAUNCHPADS: legacyRecord ? `${legacyRecord.launchpad}:${legacyRecord.deploymentBlock}` : "",
      SOCIAL_DEPLOYMENT_BLOCK: record.deploymentBlock,
      SENTRY_RELEASE: `curveball-backend@${release}`,
    });
  }
  if (await Bun.file("deploy/keeper.env").exists()) {
    await updateEnv("deploy/keeper.env", {
      KEEPER_CHAIN_ID: String(chainId),
      KEEPER_LAUNCHPAD_ADDRESS: record.launchpad,
      KEEPER_LEGACY_LAUNCHPADS: legacyRecord ? `${legacyRecord.launchpad}:${legacyRecord.deploymentBlock}` : "",
      KEEPER_DEPLOYMENT_BLOCK: record.deploymentBlock,
      SENTRY_RELEASE: `curveball-keeper@${release}`,
    });
  }
} else {
  await updateEnv(".env.production", releaseValues);
  if (oracleRelease) {
    if (await Bun.file("services/backend/.env.mainnet.local").exists())
      await updateEnv("services/backend/.env.mainnet.local", {
        SOCIAL_CHAIN_ID: String(chainId),
        SOCIAL_LAUNCHPAD_ADDRESS: record.launchpad,
        SOCIAL_DEPLOYMENT_BLOCK: record.deploymentBlock,
        SOCIAL_LAUNCH_FEE_MODE: "oracle",
        SOCIAL_LEGACY_LAUNCHPADS: `${legacyRecord!.launchpad}:${legacyRecord!.deploymentBlock}`,
      });
    if (await Bun.file("keeper/.env.mainnet.local").exists())
      await updateEnv("keeper/.env.mainnet.local", {
        KEEPER_CHAIN_ID: String(chainId),
        KEEPER_LAUNCHPAD_ADDRESS: record.launchpad,
        KEEPER_DEPLOYMENT_BLOCK: record.deploymentBlock,
        KEEPER_LEGACY_LAUNCHPADS: `${legacyRecord!.launchpad}:${legacyRecord!.deploymentBlock}`,
      });
  }
}

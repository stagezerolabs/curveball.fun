export {};

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const isTestnet = requestedNetwork === "testnet";
const chainId = isTestnet ? 11_155_931 : 4_153;
const recordPath = isTestnet
  ? "deployments/11155931/curveball.json"
  : "deployments/4153/curveball.json";
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

const values = {
  VITE_CHAIN_ID: String(record.chainId),
  ...(isTestnet ? { VITE_RPC_URL: "https://testnet.riselabs.xyz" } : {}),
  VITE_LAUNCHPAD_ADDRESS: record.launchpad,
  VITE_DEPLOYMENT_BLOCK: record.deploymentBlock,
};
async function updateEnv(path: string, entries: Record<string, string>) {
  let source = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    source = new RegExp(`^${key}=.*$`, "m").test(source)
      ? source.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${source.trimEnd() ? `${source.trimEnd()}\n` : ""}${line}\n`;
  }
  source = source.replace(/^VITE_FACTORY_VERSION=.*(?:\r?\n|$)/m, "");
  await Bun.write(path, source);
  console.log(`Updated ${path} for RISE ${requestedNetwork} launchpad ${record.launchpad}.`);
}

if (isTestnet) {
  for (const path of [".env", ".env.local", ".env.testnet.local"]) {
    await updateEnv(path, values);
  }
  await updateEnv("services/social/.env", {
    SOCIAL_CHAIN_ID: String(chainId),
    SOCIAL_LAUNCHPAD_ADDRESS: record.launchpad,
    SOCIAL_DEPLOYMENT_BLOCK: record.deploymentBlock,
  });
  await updateEnv("keeper/.env", {
    KEEPER_CHAIN_ID: String(chainId),
    KEEPER_LAUNCHPAD_ADDRESS: record.launchpad,
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
    });
  }
  if (await Bun.file("deploy/social.env").exists()) {
    await updateEnv("deploy/social.env", {
      SOCIAL_CHAIN_ID: String(chainId),
      SOCIAL_LAUNCHPAD_ADDRESS: record.launchpad,
      SOCIAL_DEPLOYMENT_BLOCK: record.deploymentBlock,
      SENTRY_RELEASE: `curveball-backend@${release}`,
    });
  }
  if (await Bun.file("deploy/keeper.env").exists()) {
    await updateEnv("deploy/keeper.env", {
      KEEPER_CHAIN_ID: String(chainId),
      KEEPER_LAUNCHPAD_ADDRESS: record.launchpad,
      KEEPER_DEPLOYMENT_BLOCK: record.deploymentBlock,
      SENTRY_RELEASE: `curveball-keeper@${release}`,
    });
  }
} else {
  await updateEnv(".env.production", values);
}

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isIP } from "node:net";

const projectRoot = resolve(import.meta.dirname, "..");
const NETWORKS = Object.freeze({ testnet: 11_155_931, mainnet: 4_153 });
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

function parseEnv(path) {
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function requireValue(values, key, source) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`${key} is missing from ${source}.`);
  if (/[\r\n]/.test(value)) throw new Error(`${key} contains a newline.`);
  return value;
}

function checkAddress(value, label) {
  if (!ADDRESS.test(value || ""))
    throw new Error(`${label} must be an Ethereum address.`);
  return value;
}

function trustedProxyCidr(values, source) {
  const value = requireValue(values, "CURVEBALL_TRUSTED_PROXY_CIDR", source);
  const parts = value.split("/");
  const ip = parts[0];
  const mask = Number(parts[1]);
  const octets = ip?.split(".").map(Number) || [];
  const privateNetwork =
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
  if (
    parts.length !== 2 ||
    isIP(ip) !== 4 ||
    !Number.isInteger(mask) ||
    mask < 16 ||
    mask > 32 ||
    !privateNetwork
  ) {
    throw new Error(
      "CURVEBALL_TRUSTED_PROXY_CIDR must be the actual private Docker proxy subnet with a /16 or narrower mask.",
    );
  }
  return value;
}

function serializeEnv(entries) {
  return `${entries
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

export function prepareProductionEnv({
  root = projectRoot,
  network = "testnet",
  gitCommit,
  dirty,
  timestamp,
} = {}) {
  const chainId = NETWORKS[network];
  if (!chainId) throw new Error("--network must be mainnet or testnet.");
  const isMainnet = network === "mainnet";
  const source = isMainnet
    ? {
        frontend: ".env.production + .env.mainnet.local",
        social: "services/backend/.env.mainnet.local",
        keeper: "keeper/.env.mainnet.local",
      }
    : { frontend: ".env", social: ".env", keeper: ".env" };
  // Mainnet secrets stay in an ignored file. The tracked .env.production supplies the recorded chain fields.
  const frontend = isMainnet
    ? {
        ...parseEnv(resolve(root, ".env.mainnet.local")),
        ...parseEnv(resolve(root, ".env.production")),
      }
    : parseEnv(resolve(root, source.frontend));
  const social = parseEnv(resolve(root, source.social));
  const keeper = parseEnv(resolve(root, source.keeper));
  const recordPath = resolve(root, `deployments/${chainId}/curveball.json`);
  if (!existsSync(recordPath))
    throw new Error(`Missing RISE ${network} deployment record: ${recordPath}`);
  const deployment = JSON.parse(readFileSync(recordPath, "utf8"));
  if (
    deployment.chainId !== chainId ||
    !ADDRESS.test(deployment.launchpad || "") ||
    !/^\d+$/.test(String(deployment.deploymentBlock ?? ""))
  ) {
    throw new Error(`Invalid RISE ${network} deployment record.`);
  }
  const swapRecordPath = resolve(
    root,
    `deployments/${chainId}/icarus-swap-adapter.json`,
  );
  const swapRecord = existsSync(swapRecordPath)
    ? JSON.parse(readFileSync(swapRecordPath, "utf8"))
    : null;
  if (isMainnet && !swapRecord) {
    throw new Error(
      "Mainnet Icarus swap adapter record is missing. Deploy and record the verified adapter before preparing the full launch stack.",
    );
  }
  if (
    swapRecord &&
    (swapRecord.chainId !== chainId ||
      swapRecord.launchpad?.toLowerCase() !==
        deployment.launchpad.toLowerCase() ||
      !ADDRESS.test(swapRecord.adapter || "") ||
      !HASH.test(swapRecord.codeHash || ""))
  )
    throw new Error(
      `Swap adapter record does not match the ${network} launchpad.`,
    );
  if (
    (frontend.VITE_ICARUS_SWAP_ADAPTER || "").toLowerCase() !==
      (swapRecord?.adapter || "").toLowerCase() ||
    (frontend.VITE_ICARUS_SWAP_ADAPTER_CODE_HASH || "").toLowerCase() !==
      (swapRecord?.codeHash || "").toLowerCase()
  )
    throw new Error(
      "Frontend swap adapter configuration does not match its deployment record.",
    );

  const expectedChain = String(chainId);
  const launchpad = deployment.launchpad;
  const deploymentBlock = String(deployment.deploymentBlock);
  const parity = [
    [
      frontend.VITE_CHAIN_ID,
      frontend.VITE_LAUNCHPAD_ADDRESS,
      frontend.VITE_DEPLOYMENT_BLOCK,
    ],
    [
      social.SOCIAL_CHAIN_ID,
      social.SOCIAL_LAUNCHPAD_ADDRESS,
      social.SOCIAL_DEPLOYMENT_BLOCK,
    ],
    [
      keeper.KEEPER_CHAIN_ID,
      keeper.KEEPER_LAUNCHPAD_ADDRESS,
      keeper.KEEPER_DEPLOYMENT_BLOCK,
    ],
  ].every(
    ([configuredChain, configuredLaunchpad, configuredBlock]) =>
      configuredChain === expectedChain &&
      configuredLaunchpad?.toLowerCase() === launchpad.toLowerCase() &&
      configuredBlock === deploymentBlock,
  );
  if (!parity)
    throw new Error(
      `Source environments do not match the recorded ${network} deployment.`,
    );
  if (isMainnet) {
    // Catch a stale local override even though Vite gives .env.production precedence at build time.
    const local = parseEnv(resolve(root, ".env.mainnet.local"));
    for (const key of [
      "VITE_CHAIN_ID",
      "VITE_LAUNCHPAD_ADDRESS",
      "VITE_DEPLOYMENT_BLOCK",
      "VITE_ICARUS_SWAP_ADAPTER",
      "VITE_ICARUS_SWAP_ADAPTER_CODE_HASH",
    ]) {
      if (
        local[key] &&
        local[key].toLowerCase() !== String(frontend[key] || "").toLowerCase()
      ) {
        throw new Error(
          `${key} in .env.mainnet.local conflicts with .env.production.`,
        );
      }
    }
  }
  const adminAddress = isMainnet
    ? checkAddress(
        requireValue(frontend, "VITE_ADMIN_ADDRESS", source.frontend),
        "VITE_ADMIN_ADDRESS",
      )
    : social.SOCIAL_ADMIN_ADDRESS ||
      frontend.VITE_ADMIN_ADDRESS ||
      "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
  if (
    isMainnet &&
    checkAddress(
      requireValue(social, "SOCIAL_ADMIN_ADDRESS", source.social),
      "SOCIAL_ADMIN_ADDRESS",
    ).toLowerCase() !== adminAddress.toLowerCase()
  ) {
    throw new Error(
      "Mainnet frontend and social admin addresses do not match.",
    );
  }
  const commit =
    gitCommit ??
    execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const isDirty =
    dirty ??
    Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
    );
  const at =
    timestamp ??
    new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const release = `${network}-${commit}${isDirty ? "-wip" : ""}-${at}`;
  const outputs = [
    [
      "deploy/production.env",
      [
        ["CURVEBALL_RELEASE", release],
        ["CURVEBALL_DB_PASSWORD", randomBytes(32).toString("base64url")],
        [
          "CURVEBALL_TRUSTED_PROXY_CIDR",
          isMainnet ? trustedProxyCidr(frontend, source.frontend) : undefined,
        ],
        ["VITE_CHAIN_ID", expectedChain],
        [
          "VITE_RPC_URL",
          requireValue(frontend, "VITE_RPC_URL", source.frontend),
        ],
        ["VITE_LAUNCHPAD_ADDRESS", launchpad],
        ["VITE_DEPLOYMENT_BLOCK", deploymentBlock],
        ["VITE_ICARUS_SWAP_ADAPTER", swapRecord?.adapter],
        ["VITE_ICARUS_SWAP_ADAPTER_CODE_HASH", swapRecord?.codeHash],
        ["VITE_SOCIAL_API_URL", "https://social-api.curveball.fun"],
        ["VITE_ADMIN_ADDRESS", adminAddress],
        ["VITE_PRIVY_APP_ID", requireValue(frontend, "VITE_PRIVY_APP_ID", source.frontend)],
        ["VITE_PRIVY_CLIENT_ID", frontend.VITE_PRIVY_CLIENT_ID],
      ],
    ],
    [
      "deploy/social.env",
      [
        [
          "SOCIAL_RPC_URL",
          requireValue(social, "SOCIAL_RPC_URL", source.social),
        ],
        ["SOCIAL_CHAIN_ID", expectedChain],
        ["SOCIAL_CHAIN_NAME", isMainnet ? "RISE Mainnet" : "RISE Testnet"],
        ["SOCIAL_NATIVE_SYMBOL", social.SOCIAL_NATIVE_SYMBOL || "ETH"],
        ["SOCIAL_LAUNCHPAD_ADDRESS", launchpad],
        ["SOCIAL_ADMIN_ADDRESS", adminAddress],
        ["SOCIAL_PROTOCOL_ACCOUNTS", social.SOCIAL_PROTOCOL_ACCOUNTS],
        ["SOCIAL_DEPLOYMENT_BLOCK", deploymentBlock],
        ["SOCIAL_PORT", social.SOCIAL_PORT || "8787"],
        ["SOCIAL_ALLOWED_ORIGINS", "https://curveball.fun"],
        ["SOCIAL_PUBLIC_ORIGIN", "https://social-api.curveball.fun"],
        ["SOCIAL_TRUST_PROXY_CLIENT_IP", isMainnet ? "1" : undefined],
        ["PRIVY_APP_ID", requireValue(social, "PRIVY_APP_ID", source.social)],
        ["PRIVY_APP_SECRET", requireValue(social, "PRIVY_APP_SECRET", source.social)],
        ["SOCIAL_CONFIRMATIONS", social.SOCIAL_CONFIRMATIONS || "2"],
        ["SOCIAL_POLL_INTERVAL_MS", social.SOCIAL_POLL_INTERVAL_MS || "3000"],
        ["SOCIAL_LOG_RANGE", social.SOCIAL_LOG_RANGE || "2000"],
        [
          "SOCIAL_METADATA_REFRESH_MS",
          social.SOCIAL_METADATA_REFRESH_MS || "300000",
        ],
        ["SOCIAL_IPFS_GATEWAY", social.SOCIAL_IPFS_GATEWAY],
        ["SOCIAL_METADATA_HOSTS", social.SOCIAL_METADATA_HOSTS],
        ["SOCIAL_RNS_API_URL", social.SOCIAL_RNS_API_URL],
        ["SOCIAL_DB_POOL_SIZE", social.SOCIAL_DB_POOL_SIZE || "10"],
        [
          "SENTRY_DSN",
          isMainnet ? social.SENTRY_DSN : social.SENTRY_BACKEND_DSN,
        ],
        ["SENTRY_ENVIRONMENT", "production"],
        ["SENTRY_RELEASE", `curveball-backend@${release}`],
        [
          "SENTRY_TRACES_SAMPLE_RATE",
          social.SENTRY_TRACES_SAMPLE_RATE || "0.1",
        ],
      ],
    ],
    [
      "deploy/keeper.env",
      [
        ["KEEPER_CHAIN_ID", expectedChain],
        [
          "KEEPER_RPC_URL",
          requireValue(keeper, "KEEPER_RPC_URL", source.keeper),
        ],
        ["KEEPER_LAUNCHPAD_ADDRESS", launchpad],
        ["KEEPER_DEPLOYMENT_BLOCK", deploymentBlock],
        [
          "KEEPER_PRIVATE_KEY",
          requireValue(keeper, "KEEPER_PRIVATE_KEY", source.keeper),
        ],
        ["KEEPER_POLL_INTERVAL_MS", keeper.KEEPER_POLL_INTERVAL_MS || "10000"],
        [
          "SENTRY_DSN",
          isMainnet ? keeper.SENTRY_DSN : keeper.SENTRY_KEEPER_DSN,
        ],
        ["SENTRY_ENVIRONMENT", "production"],
        ["SENTRY_RELEASE", `curveball-keeper@${release}`],
        [
          "SENTRY_TRACES_SAMPLE_RATE",
          keeper.SENTRY_TRACES_SAMPLE_RATE || "0.1",
        ],
      ],
    ],
    [
      "deploy/web.env",
      [["PINATA_JWT", requireValue(frontend, "PINATA_JWT", source.frontend)]],
    ],
  ];
  // Validate every source and destination before writing any secret-bearing file.
  for (const [path] of outputs) {
    if (existsSync(resolve(root, path)))
      throw new Error(`Refusing to overwrite ${resolve(root, path)}.`);
  }
  for (const [path, entries] of outputs) {
    const target = resolve(root, path);
    writeFileSync(target, serializeEnv(entries), { mode: 0o600 });
    chmodSync(target, 0o600);
  }
  return release;
}

function parseArgs(args) {
  if (args.length === 0) return "testnet"; // Preserve the original testnet default for existing callers.
  if (args.length !== 2 || args[0] !== "--network" || !NETWORKS[args[1]]) {
    throw new Error(
      "Usage: bun deploy/prepare-production-env.mjs --network mainnet|testnet",
    );
  }
  return args[1];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const release = prepareProductionEnv({
    network: parseArgs(process.argv.slice(2)),
  });
  console.log(`Prepared ignored production environments for ${release}.`);
}

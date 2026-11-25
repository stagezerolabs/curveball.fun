import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { prepareProductionEnv } from "./prepare-production-env.mjs";

const launchpad = "0x1111111111111111111111111111111111111111";
const adapter = "0x2222222222222222222222222222222222222222";
const admin = "0x3333333333333333333333333333333333333333";
const hash = `0x${"a".repeat(64)}`;
const storkOracle = "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62";
const storkFeedId = "0x7965e1bfc07a34caf0c3aa8146b200264fbb7a0eb85b1d3b1fdceecffd736b02";

function withFixture(network, run) {
  const root = mkdtempSync(join(tmpdir(), "curveball-deploy-"));
  mkdirSync(join(root, "deploy"));
  const chain = network === "mainnet" ? 4153 : 11155931;
  const write = (path, value) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, value);
  };
  const record = { version: "oracle-v3", chainId: chain, launchpad, deploymentBlock: "100",
    storkOracle, storkFeedId, launchFeeUsd: "1000000000000000000", maxOracleAgeSeconds: "1800" };
  write(`deployments/${chain}/curveball-oracle-v3.json`, JSON.stringify(record));
  write(`deployments/${chain}/icarus-swap-adapter-oracle-v3.json`, JSON.stringify({ chainId: chain, launchpad, adapter, codeHash: hash }));
  const front = `VITE_CHAIN_ID=${chain}\nVITE_RPC_URL=https://rpc.example\nVITE_LAUNCHPAD_ADDRESS=${launchpad}\nVITE_DEPLOYMENT_BLOCK=100\nVITE_ICARUS_SWAP_ADAPTER=${adapter}\nVITE_ICARUS_SWAP_ADAPTER_CODE_HASH=${hash}\nVITE_PRIVY_APP_ID=test-app\n`;
  const secrets = `VITE_ADMIN_ADDRESS=${admin}\nPINATA_JWT=pinata-secret\nCURVEBALL_TRUSTED_PROXY_CIDR=172.28.0.0/16\n`;
  const social = `SOCIAL_CHAIN_ID=${chain}\nSOCIAL_RPC_URL=https://rpc.example\nSOCIAL_LAUNCHPAD_ADDRESS=${launchpad}\nSOCIAL_DEPLOYMENT_BLOCK=100\nSOCIAL_ADMIN_ADDRESS=${admin}\nPRIVY_APP_ID=test-app\nPRIVY_APP_SECRET=test-secret\n`;
  const keeper = `KEEPER_CHAIN_ID=${chain}\nKEEPER_RPC_URL=https://rpc.example\nKEEPER_LAUNCHPAD_ADDRESS=${launchpad}\nKEEPER_DEPLOYMENT_BLOCK=100\n${network === "testnet" ? `KEEPER_PRIVATE_KEY=0x${"b".repeat(64)}\n` : ""}`;
  if (network === "mainnet") {
    write(".env.production", front);
    write(".env.mainnet.local", secrets);
    write("services/backend/.env.mainnet.local", social);
    write("keeper/.env.mainnet.local", keeper);
  } else {
    write(".env", front + secrets + social + keeper);
  }
  try { run({ root, chain, write, record }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function prepare(root, network) {
  return prepareProductionEnv({ root, network, gitCommit: "abc123", dirty: false, timestamp: "20261106T000000Z" });
}

test("mainnet writes one oracle deployment to every service", () => withFixture("mainnet", ({ root }) => {
  assert.equal(prepare(root, "mainnet"), "mainnet-abc123-20261106T000000Z");
  for (const [file, prefix] of [["production", "VITE"], ["social", "SOCIAL"], ["keeper", "KEEPER"]]) {
    const content = readFileSync(join(root, `deploy/${file}.env`), "utf8");
    assert.match(content, new RegExp(`${prefix}_LAUNCHPAD_ADDRESS=${launchpad}`));
    assert.doesNotMatch(content, /LEGACY|LAUNCH_FEE_MODE|fixed/);
  }
  assert.match(readFileSync(join(root, "deploy/keeper.env"), "utf8"), /KEEPER_PRIVATE_KEY_FILE=\/run\/secrets\/keeper_private_key/);
  assert.match(readFileSync(join(root, "deploy/web.env"), "utf8"), /PINATA_JWT=pinata-secret/);
}));

test("missing or mismatched oracle records block release files", () => withFixture("mainnet", ({ root, chain, write, record }) => {
  write(`deployments/${chain}/curveball-oracle-v3.json`, JSON.stringify({ ...record, maxOracleAgeSeconds: "60" }));
  assert.throws(() => prepare(root, "mainnet"), /Oracle deployment record/);
  assert.equal(existsSync(join(root, "deploy/production.env")), false);
}));

test("an old adapter cannot be paired with the new launchpad", () => withFixture("mainnet", ({ root, chain, write }) => {
  write(`deployments/${chain}/icarus-swap-adapter-oracle-v3.json`, JSON.stringify({ chainId: chain, launchpad: admin, adapter, codeHash: hash }));
  assert.throws(() => prepare(root, "mainnet"), /Swap adapter record/);
}));

test("mainnet refuses an inline keeper key", () => withFixture("mainnet", ({ root, write }) => {
  write("keeper/.env.mainnet.local", `KEEPER_PRIVATE_KEY=0x${"b".repeat(64)}\n`);
  assert.throws(() => prepare(root, "mainnet"), /host secret file/);
}));

test("existing destinations are never overwritten", () => withFixture("mainnet", ({ root, write }) => {
  write("deploy/keeper.env", "keep-existing");
  assert.throws(() => prepare(root, "mainnet"), /Refusing to overwrite/);
  assert.equal(readFileSync(join(root, "deploy/keeper.env"), "utf8"), "keep-existing");
}));

test("testnet can prepare the same oracle release", () => withFixture("testnet", ({ root }) => {
  prepare(root, "testnet");
  assert.match(readFileSync(join(root, "deploy/social.env"), "utf8"), /SOCIAL_CHAIN_ID=11155931/);
  assert.doesNotMatch(readFileSync(join(root, "deploy/social.env"), "utf8"), /LEGACY/);
}));

import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { prepareProductionEnv } from "./prepare-production-env.mjs";

const launchpad = "0x1111111111111111111111111111111111111111";
const adapter = "0x2222222222222222222222222222222222222222";
const admin = "0x3333333333333333333333333333333333333333";
const hash = `0x${"a".repeat(64)}`;
const keeperKey = `0x${"b".repeat(64)}`;

function fixture(network) {
  const root = mkdtempSync(join(tmpdir(), "curveball-deploy-"));
  mkdirSync(join(root, "deploy"));
  const chain = network === "mainnet" ? 4153 : 11155931;
  const write = (path, content) => {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  };
  const record = { chainId: chain, launchpad, deploymentBlock: "100" };
  write(`deployments/${chain}/curveball.json`, JSON.stringify(record));
  write(
    `deployments/${chain}/icarus-swap-adapter.json`,
    JSON.stringify({
      chainId: chain,
      launchpad,
      adapter,
      codeHash: hash,
    }),
  );
  const front = `VITE_CHAIN_ID=${chain}\nVITE_RPC_URL=https://rpc.example\nVITE_LAUNCHPAD_ADDRESS=${launchpad}\nVITE_DEPLOYMENT_BLOCK=100\nVITE_ICARUS_SWAP_ADAPTER=${adapter}\nVITE_ICARUS_SWAP_ADAPTER_CODE_HASH=${hash}\nVITE_PRIVY_APP_ID=test-privy-app\n`;
  const secrets = `VITE_ADMIN_ADDRESS=${admin}\nPINATA_JWT=pinata-secret\nCURVEBALL_TRUSTED_PROXY_CIDR=172.28.0.0/16\n`;
  const social = `SOCIAL_CHAIN_ID=${chain}\nSOCIAL_RPC_URL=https://rpc.example\nSOCIAL_LAUNCHPAD_ADDRESS=${launchpad}\nSOCIAL_DEPLOYMENT_BLOCK=100\nSOCIAL_ADMIN_ADDRESS=${admin}\nPRIVY_APP_ID=test-privy-app\nPRIVY_APP_SECRET=test-privy-secret\n`;
  const keeper = `KEEPER_CHAIN_ID=${chain}\nKEEPER_RPC_URL=https://rpc.example\nKEEPER_LAUNCHPAD_ADDRESS=${launchpad}\nKEEPER_DEPLOYMENT_BLOCK=100\nKEEPER_PRIVATE_KEY=${keeperKey}\n`;
  if (network === "mainnet") {
    write(".env.production", front);
    write(".env.mainnet.local", secrets);
    write("services/backend/.env.mainnet.local", social);
    write("keeper/.env.mainnet.local", keeper);
  } else {
    write(
      ".env",
      front +
        secrets +
        social +
        keeper +
        "SENTRY_BACKEND_DSN=https://backend.example/1\nSENTRY_KEEPER_DSN=https://keeper.example/2\n",
    );
  }
  return { root, write, chain };
}

function withFixture(network, run) {
  const context = fixture(network);
  try {
    run(context);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
}

function prepare(root, network) {
  return prepareProductionEnv({
    root,
    network,
    gitCommit: "abc123",
    dirty: false,
    timestamp: "20261106T000000Z",
  });
}

test("mainnet creates matching chain env files and explicit admin", () =>
  withFixture("mainnet", ({ root }) => {
    assert.equal(prepare(root, "mainnet"), "mainnet-abc123-20261106T000000Z");
    const front = readFileSync(join(root, "deploy/production.env"), "utf8");
    const social = readFileSync(join(root, "deploy/social.env"), "utf8");
    const keeper = readFileSync(join(root, "deploy/keeper.env"), "utf8");
    assert.match(front, /VITE_CHAIN_ID=4153/);
    assert.match(front, new RegExp(`VITE_ICARUS_SWAP_ADAPTER=${adapter}`));
    assert.match(front, new RegExp(`VITE_ADMIN_ADDRESS=${admin}`));
    assert.match(front, /CURVEBALL_TRUSTED_PROXY_CIDR=172\.28\.0\.0\/16/);
    assert.match(social, /SOCIAL_CHAIN_NAME=RISE Mainnet/);
    assert.match(social, /SOCIAL_CHAIN_ID=4153/);
    assert.match(social, /SOCIAL_TRUST_PROXY_CLIENT_IP=1/);
    assert.match(keeper, /KEEPER_CHAIN_ID=4153/);
    assert.match(
      readFileSync(join(root, "deploy/web.env"), "utf8"),
      /PINATA_JWT=pinata-secret/,
    );
  }));

test("mainnet refuses missing Icarus adapter before writing files", () =>
  withFixture("mainnet", ({ root, chain }) => {
    rmSync(join(root, `deployments/${chain}/icarus-swap-adapter.json`));
    assert.throws(
      () => prepare(root, "mainnet"),
      /Mainnet Icarus swap adapter record is missing/,
    );
    assert.equal(existsSync(join(root, "deploy/production.env")), false);
  }));

test("mainnet refuses a broad trusted proxy range", () =>
  withFixture("mainnet", ({ root, write }) => {
    write(
      ".env.mainnet.local",
      `VITE_ADMIN_ADDRESS=${admin}\nPINATA_JWT=pinata-secret\nCURVEBALL_TRUSTED_PROXY_CIDR=0.0.0.0/0\n`,
    );
    assert.throws(
      () => prepare(root, "mainnet"),
      /actual private Docker proxy subnet/,
    );
    assert.equal(existsSync(join(root, "deploy/production.env")), false);
  }));

test("mainnet refuses deployment and admin mismatches", () =>
  withFixture("mainnet", ({ root, write }) => {
    write(
      "services/backend/.env.mainnet.local",
      `SOCIAL_CHAIN_ID=11155931\nSOCIAL_RPC_URL=https://rpc.example\nSOCIAL_LAUNCHPAD_ADDRESS=${launchpad}\nSOCIAL_DEPLOYMENT_BLOCK=100\nSOCIAL_ADMIN_ADDRESS=${admin}\nPRIVY_APP_ID=test-privy-app\nPRIVY_APP_SECRET=test-privy-secret\n`,
    );
    assert.throws(
      () => prepare(root, "mainnet"),
      /Source environments do not match/,
    );
    assert.equal(existsSync(join(root, "deploy/production.env")), false);
    write(
      "services/backend/.env.mainnet.local",
      `SOCIAL_CHAIN_ID=4153\nSOCIAL_RPC_URL=https://rpc.example\nSOCIAL_LAUNCHPAD_ADDRESS=${launchpad}\nSOCIAL_DEPLOYMENT_BLOCK=100\nPRIVY_APP_ID=test-privy-app\nPRIVY_APP_SECRET=test-privy-secret\n`,
    );
    assert.throws(
      () => prepare(root, "mainnet"),
      /SOCIAL_ADMIN_ADDRESS is missing/,
    );
    assert.equal(existsSync(join(root, "deploy/production.env")), false);
  }));

test("testnet behavior remains available", () =>
  withFixture("testnet", ({ root }) => {
    assert.match(prepare(root, "testnet"), /^testnet-/);
    assert.match(
      readFileSync(join(root, "deploy/social.env"), "utf8"),
      /SOCIAL_CHAIN_NAME=RISE Testnet/,
    );
    assert.match(
      readFileSync(join(root, "deploy/social.env"), "utf8"),
      /SENTRY_DSN=https:\/\/backend\.example\/1/,
    );
    assert.match(
      readFileSync(join(root, "deploy/keeper.env"), "utf8"),
      /SENTRY_DSN=https:\/\/keeper\.example\/2/,
    );
  }));

test("existing destinations are never overwritten", () =>
  withFixture("mainnet", ({ root, write }) => {
    write("deploy/keeper.env", "keep-existing");
    assert.throws(() => prepare(root, "mainnet"), /Refusing to overwrite/);
    assert.equal(
      readFileSync(join(root, "deploy/keeper.env"), "utf8"),
      "keep-existing",
    );
    assert.equal(existsSync(join(root, "deploy/production.env")), false);
  }));

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBuybackActions } from "./src/features/buybacks/actions.mjs";
import { createGraduationActions } from "./src/features/graduation/actions.mjs";
import { createMarketCatalog } from "./src/features/markets/catalog.mjs";
import { readKeeperConstants } from "./src/features/markets/constants.mjs";
import { readMarketStatus } from "./src/features/markets/status.mjs";
import { createRetryPolicy, FAILURE_RETRY_MS } from "./src/runtime/retry.mjs";
import { createTransactionSender } from "./src/runtime/transactions.mjs";

import {
  captureKeeperException,
  flushKeeperEvents,
  traceKeeperSweep,
} from "./src/runtime/instrument.mjs";

const STATUS_CONCURRENCY = 8;
// These cooldowns add detection latency, never a wrong action: the decision
// checks current status whenever the market is read.
const TRADING_POLL_MS = 60_000;
const IDLE_BUYBACK_POLL_MS = 10 * 60_000;

async function mapConcurrent(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        try {
          results[index] = { value: await task(items[index]) };
        } catch (error) {
          results[index] = { error };
        }
      }
    }),
  );
  return results;
}

export function createGraduationKeeper({
  publicClient,
  walletClient,
  launchpad,
  deploymentBlock,
  logger = console,
  now = Date.now,
}) {
  const catalog = createMarketCatalog({
    publicClient,
    launchpad,
    deploymentBlock,
  });
  const retry = createRetryPolicy({ now, logger });
  const send = createTransactionSender({ publicClient, walletClient, logger });
  const lastStatus = new Map();
  let features;

  async function tick() {
    if (!features) {
      const constants = await readKeeperConstants({ publicClient, launchpad });
      features = {
        constants,
        graduation: createGraduationActions({
          publicClient,
          walletClient,
          launchpad,
          constants,
          logger,
          now,
          send,
          retry,
        }),
        buybacks: createBuybackActions({
          publicClient,
          walletClient,
          constants,
          logger,
          now,
          send,
          retry,
        }),
      };
    }
    await catalog.discoverLaunches();
    // Reads are concurrent; writes stay serial for the keeper wallet nonce.
    const nowMs = now();
    const reads = [...catalog.markets].filter(([key]) => {
      if (!retry.canAttempt(key, nowMs)) return false;
      const last = lastStatus.get(key);
      if (!last) return true;
      const age = nowMs - last.readAt;
      if (
        last.value.state === "graduated" &&
        last.value.buyback?.balance === 0n
      )
        return age >= IDLE_BUYBACK_POLL_MS;
      if (last.value.state === "trading") return age >= TRADING_POLL_MS;
      return true;
    });
    const statuses = await mapConcurrent(
      reads,
      STATUS_CONCURRENCY,
      ([, token]) =>
        readMarketStatus({
          publicClient,
          launchpad,
          constants: features.constants,
          token,
        }),
    );
    for (const [index, [key, token]] of reads.entries()) {
      try {
        if (statuses[index].error) throw statuses[index].error;
        lastStatus.set(key, { value: statuses[index].value, readAt: now() });
        const action = await features.graduation.act(
          key,
          token,
          statuses[index].value,
        );
        if (action === "convert")
          await features.buybacks.convertMarket(key, token);
      } catch (error) {
        captureKeeperException(error, "market-action");
        logger.error(
          `Keeper action failed for ${token}: ${error instanceof Error ? error.message : String(error)}`,
        );
        retry.backOff(key, token, "Keeper action failed", FAILURE_RETRY_MS);
      }
    }
    await features.buybacks.runCurveBuyback();
  }

  return { tick };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function main() {
  const rpcUrl = required("KEEPER_RPC_URL");
  const launchpad = required("KEEPER_LAUNCHPAD_ADDRESS");
  const privateKey = required("KEEPER_PRIVATE_KEY");
  const chainId = Number(required("KEEPER_CHAIN_ID"));
  const deploymentBlock = BigInt(required("KEEPER_DEPLOYMENT_BLOCK"));
  const intervalMs = Number(process.env.KEEPER_POLL_INTERVAL_MS || 10_000);
  if (
    !isAddress(launchpad) ||
    !/^0x[0-9a-fA-F]{64}$/.test(privateKey) ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    deploymentBlock < 0n ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1_000
  ) {
    throw new Error("Invalid keeper configuration.");
  }
  const chain = defineChain({
    id: chainId,
    name: "Keeper chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  if ((await publicClient.getChainId()) !== chainId)
    throw new Error("Keeper RPC is on the wrong chain.");
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const keeper = createGraduationKeeper({
    publicClient,
    walletClient,
    launchpad: getAddress(launchpad),
    deploymentBlock,
  });
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  console.info(
    `Keeper started for launchpad ${getAddress(launchpad)} on chain ${chainId}.`,
  );
  while (!stopping) {
    try {
      await traceKeeperSweep(() => keeper.tick());
    } catch (error) {
      captureKeeperException(error, "sweep");
      console.error(
        `Keeper sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!stopping)
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  await flushKeeperEvents();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(async (error) => {
    captureKeeperException(error, "startup");
    console.error(error instanceof Error ? error.message : String(error));
    await flushKeeperEvents();
    process.exitCode = 1;
  });
}

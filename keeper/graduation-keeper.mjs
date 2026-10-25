import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  captureKeeperException,
  flushKeeperEvents,
  traceKeeperSweep,
} from "./instrument.mjs";

const launchpadAbi = parseAbi([
  "function escrow() view returns (address)",
  "function GRADUATION_TIMEOUT() view returns (uint256)",
  "function SUPPLY() view returns (uint256)",
  "function CURVE_SUPPLY() view returns (uint256)",
  "function market(address token) view returns ((address creator,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 taxBps,uint8 state,uint128 virtualToken,uint128 virtualQuote,uint128 initialVirtualQuote,uint128 realQuote,uint128 reserveTokens,uint40 readyAt,address pool))",
  "function graduate(address token) returns (address pool)",
  "function abortGraduation(address token)",
  "event LaunchCreated(address indexed token,address indexed creator,string name,string symbol,string uri,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 taxBps,uint256 reserveTokens)",
]);
const escrowAbi = parseAbi([
  "function BUYBACK_INTERVAL() view returns (uint256)",
  "function buybackBalance(address token) view returns (uint256)",
  "function lastBuyback(address token) view returns (uint256)",
  "function buyback(address token) returns (uint256 burned)",
  "event BuybackSkipped(address indexed token,uint8 reason)",
]);

/** CurveLaunchpad.State, in enum order. */
const STATES = ["none", "trading", "ready", "graduated", "aborted"];
const SKIP_REASONS = [
  "too few observations",
  "quote failed",
  "Icarus paused",
  "price outside the band",
];
const LOG_RANGE = 5_000n;
const LOG_SCAN_CONCURRENCY = 4;
const STATUS_CONCURRENCY = 8;
const FAILURE_RETRY_MS = 60_000;
const MAX_RETRY_MS = 6 * 3_600_000;
/// `tick` leaves unread any market it recently read in a state that only changes slowly: a trading
/// curve only turns actionable when someone trades it, and an idle graduated curve only when pool
/// fees accrue. These cooldowns add detection latency, never a wrong action: `decide` is the
/// correctness guard whatever the read set looks like.
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

/**
 * What the keeper should do for one market now:
 * - Ready → graduate. Icarus's pause never matters: graduation doesn't check it.
 * - Ready past the timeout, when graduation can't go through → abort, which reopens sells.
 * - Aborted and sold out again → graduate.
 * - Graduated with a buyback balance and the interval elapsed → buyback.
 */
export function decide({
  state,
  soldOut,
  readyAt,
  nowSeconds,
  timeout,
  graduationReverts = false,
  buyback,
}) {
  if (state === "ready") {
    if (graduationReverts && nowSeconds >= readyAt + timeout) return "abort";
    return graduationReverts ? "wait" : "graduate";
  }
  if (state === "aborted")
    return soldOut && !graduationReverts ? "graduate" : "wait";
  if (
    state === "graduated" &&
    buyback &&
    buyback.balance > 0n &&
    (buyback.last === 0n || nowSeconds >= buyback.last + buyback.interval)
  )
    return "buyback";
  return "wait";
}

export function createGraduationKeeper({
  publicClient,
  walletClient,
  launchpad,
  deploymentBlock,
  logger = console,
  now = Date.now,
}) {
  const markets = new Map();
  const retryAfter = new Map();
  const failures = new Map();
  const lastStatus = new Map();
  let nextBlock = deploymentBlock;
  let constants;

  function backOff(key, token, reason, baseMs) {
    const attempts = (failures.get(key) ?? 0) + 1;
    failures.set(key, attempts);
    const delay = Math.min(
      baseMs * 2 ** Math.min(attempts - 1, 8),
      MAX_RETRY_MS,
    );
    retryAfter.set(key, now() + delay);
    logger.warn(
      `${reason} for ${token}; retrying in ${Math.round(delay / 1_000)} seconds.`,
    );
  }

  function clearBackOff(key) {
    retryAfter.delete(key);
    failures.delete(key);
  }

  async function readConstants() {
    const [escrow, timeout, supply, curveSupply] = await Promise.all([
      publicClient.readContract({
        address: launchpad,
        abi: launchpadAbi,
        functionName: "escrow",
      }),
      publicClient.readContract({
        address: launchpad,
        abi: launchpadAbi,
        functionName: "GRADUATION_TIMEOUT",
      }),
      publicClient.readContract({
        address: launchpad,
        abi: launchpadAbi,
        functionName: "SUPPLY",
      }),
      publicClient.readContract({
        address: launchpad,
        abi: launchpadAbi,
        functionName: "CURVE_SUPPLY",
      }),
    ]);
    const interval = await publicClient.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "BUYBACK_INTERVAL",
    });
    return {
      escrow,
      timeout,
      terminalVirtualToken: supply - curveSupply,
      interval,
    };
  }

  async function readStatus(token) {
    const market = await publicClient.readContract({
      address: launchpad,
      abi: launchpadAbi,
      functionName: "market",
      args: [token],
    });
    const state = STATES[market.state] ?? "none";
    const status = {
      state,
      soldOut: market.virtualToken === constants.terminalVirtualToken,
      readyAt: BigInt(market.readyAt),
    };
    if (state !== "graduated") return status;
    const [balance, last] = await Promise.all([
      publicClient.readContract({
        address: constants.escrow,
        abi: escrowAbi,
        functionName: "buybackBalance",
        args: [token],
      }),
      publicClient.readContract({
        address: constants.escrow,
        abi: escrowAbi,
        functionName: "lastBuyback",
        args: [token],
      }),
    ]);
    return {
      ...status,
      buyback: { balance, last, interval: constants.interval },
    };
  }

  async function simulates(functionName, address, abi, token) {
    try {
      await publicClient.simulateContract({
        account: walletClient.account,
        address,
        abi,
        functionName,
        args: [token],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Sends one keeper transaction; returns its receipt, or null while an earlier one may still land. */
  async function send(functionName, address, abi, token) {
    // The keeper has a dedicated wallet. A pending nonce means a prior call may
    // still land, so wait for the next sweep instead of sending a duplicate.
    const [latest, pending] = await Promise.all([
      publicClient.getTransactionCount({
        address: walletClient.account.address,
        blockTag: "latest",
      }),
      publicClient.getTransactionCount({
        address: walletClient.account.address,
        blockTag: "pending",
      }),
    ]);
    if (pending > latest) return null;
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address,
      abi,
      functionName,
      args: [token],
    });
    const hash = await walletClient.writeContract(request);
    logger.info(`${functionName} submitted for ${token}: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 90_000,
    });
    if (receipt.status !== "success")
      throw new Error(`${functionName} reverted: ${hash}`);
    return receipt;
  }

  function skipReason(receipt) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== constants.escrow.toLowerCase())
        continue;
      try {
        const event = decodeEventLog({
          abi: escrowAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (event.eventName === "BuybackSkipped")
          return (
            SKIP_REASONS[event.args.reason] ?? `reason ${event.args.reason}`
          );
      } catch {
        /* Other escrow events. */
      }
    }
    return null;
  }

  async function act(key, token, status) {
    const nowSeconds = BigInt(Math.floor(now() / 1_000));
    const needsGraduation =
      status.state === "ready" ||
      (status.state === "aborted" && status.soldOut);
    const graduationReverts =
      needsGraduation &&
      !(await simulates("graduate", launchpad, launchpadAbi, token));
    const action = decide({
      ...status,
      nowSeconds,
      timeout: constants.timeout,
      graduationReverts,
    });

    if (action === "graduate" || action === "abort") {
      const functionName =
        action === "graduate" ? "graduate" : "abortGraduation";
      const receipt = await send(functionName, launchpad, launchpadAbi, token);
      if (receipt) {
        logger.info(
          `${action === "graduate" ? "Graduated" : "Aborted the stuck graduation of"} ${token}.`,
        );
        clearBackOff(key);
      }
    } else if (action === "buyback") {
      const receipt = await send("buyback", constants.escrow, escrowAbi, token);
      if (!receipt) return;
      const skipped = skipReason(receipt);
      // A skip spends nothing and doesn't start the interval; back off so a quiet pool isn't polled hourly.
      if (skipped)
        backOff(
          key,
          token,
          `Buyback skipped (${skipped})`,
          Number(constants.interval) * 1_000,
        );
      else clearBackOff(key);
    } else if (needsGraduation && graduationReverts) {
      backOff(key, token, "Graduation would revert", FAILURE_RETRY_MS);
    }
  }

  async function discoverLaunches() {
    const latest = await publicClient.getBlockNumber();
    while (nextBlock <= latest) {
      const ranges = [];
      for (
        let block = nextBlock;
        block <= latest && ranges.length < LOG_SCAN_CONCURRENCY;
        block += LOG_RANGE
      ) {
        const toBlock =
          block + LOG_RANGE - 1n < latest ? block + LOG_RANGE - 1n : latest;
        ranges.push({ fromBlock: block, toBlock });
      }
      const batches = await Promise.all(
        ranges.map((range) =>
          publicClient.getContractEvents({
            address: launchpad,
            abi: launchpadAbi,
            eventName: "LaunchCreated",
            ...range,
            strict: true,
          }),
        ),
      );
      for (const logs of batches) {
        for (const log of logs) {
          const token = getAddress(log.args.token);
          markets.set(token.toLowerCase(), token);
        }
      }
      nextBlock = ranges.at(-1).toBlock + 1n;
    }
  }

  async function tick() {
    constants ??= await readConstants();
    await discoverLaunches();
    // Reads are independent; writes remain serial for the keeper wallet nonce. Markets that are
    // backing off, or that were recently read in a state which only changes slowly, are left
    // unread so the sweep's read cost stays with the markets that can actually act.
    const nowMs = now();
    const reads = [...markets].filter(([key]) => {
      if ((retryAfter.get(key) ?? 0) > nowMs) return false;
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
      ([, token]) => readStatus(token),
    );
    for (const [index, [key, token]] of reads.entries()) {
      try {
        if (statuses[index].error) throw statuses[index].error;
        lastStatus.set(key, { value: statuses[index].value, readAt: now() });
        await act(key, token, statuses[index].value);
      } catch (error) {
        captureKeeperException(error, "market-action");
        logger.error(
          `Keeper action failed for ${token}: ${error instanceof Error ? error.message : String(error)}`,
        );
        backOff(key, token, "Keeper action failed", FAILURE_RETRY_MS);
      }
    }
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

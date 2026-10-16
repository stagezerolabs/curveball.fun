import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const factoryAbi = parseAbi([
  "function curveSupply() view returns (uint256)",
  "function supply() view returns (uint256)",
  "function venueOf(address token) view returns (address)",
  "function graduate(address token)",
  "function createGraduatedPool(address token) returns (address pool)",
  "event LaunchCreated(address indexed token,address indexed curve,address indexed creator,string name,string symbol,string uri)",
]);
const curveAbi = parseAbi([
  "function sold() view returns (uint128)",
  "function ready() view returns (bool)",
  "function graduated() view returns (bool)",
  "function pool() view returns (address)",
  "function reserveAmount() view returns (uint256)",
  "function realQuote() view returns (uint128)",
]);
const venueAbi = parseAbi(["function check(address token,uint256 tokenLiquidity,uint256 quoteLiquidity) view"]);
const LOG_RANGE = 5_000n;
const LOG_SCAN_CONCURRENCY = 4;
const DEFERRED_RETRY_MS = 60_000;
const MAX_DEFERRED_RETRY_MS = 3_600_000;
const STATUS_CONCURRENCY = 8;

async function mapConcurrent(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { value: await task(items[index]) }; }
      catch (error) { results[index] = { error }; }
    }
  }));
  return results;
}

export async function processMarket({ token, curveSupply, readState, canPrepare = async () => true, send }) {
  let state = await readState();
  if (state.graduated) return { status: "graduated", pool: state.pool };
  if (state.sold !== curveSupply) return { status: "bonding" };

  if (!state.ready) {
    if (!await canPrepare()) return { status: "deferred" };
    const sent = await send("graduate", token);
    if (!sent) return { status: "transaction-pending" };
    state = await readState();
    if (state.graduated) return { status: "graduated", pool: state.pool };
    if (state.sold !== curveSupply) return { status: "bonding" };
    if (!state.ready) return { status: "deferred" };
  }

  // A sale can reopen the curve between preparation and pool creation.
  state = await readState();
  if (state.graduated) return { status: "graduated", pool: state.pool };
  if (state.sold !== curveSupply || !state.ready) return { status: "bonding" };
  const sent = await send("createGraduatedPool", token);
  if (!sent) return { status: "transaction-pending" };
  state = await readState();
  if (!state.graduated || !state.pool || state.pool === zeroAddress) {
    throw new Error("Pool creation confirmed without a graduated curve and pool address.");
  }
  return { status: "graduated", pool: state.pool };
}

export function createGraduationKeeper({ publicClient, walletClient, factory, deploymentBlock, logger = console, now = Date.now }) {
  const markets = new Map();
  const retryAfter = new Map();
  const deferCount = new Map();
  let nextBlock = deploymentBlock;
  let curveSupply;

  function scheduleRetry(key, token, reason) {
    const attempts = (deferCount.get(key) ?? 0) + 1;
    deferCount.set(key, attempts);
    const delay = Math.min(DEFERRED_RETRY_MS * 2 ** Math.min(attempts - 1, 6), MAX_DEFERRED_RETRY_MS);
    retryAfter.set(key, now() + delay);
    logger.warn(`${reason} for ${token}; retrying in ${Math.round(delay / 1_000)} seconds.`);
  }

  async function readState(curve) {
    const [sold, ready, graduated, pool] = await Promise.all([
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: "sold" }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: "ready" }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduated" }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: "pool" }),
    ]);
    return { sold, ready, graduated, pool };
  }

  async function send(functionName, token) {
    // The keeper has a dedicated wallet. A pending nonce means a prior call may
    // still land, so wait for the next sweep instead of sending a duplicate.
    const [latest, pending] = await Promise.all([
      publicClient.getTransactionCount({ address: walletClient.account.address, blockTag: "latest" }),
      publicClient.getTransactionCount({ address: walletClient.account.address, blockTag: "pending" }),
    ]);
    if (pending > latest) return false;
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: factory,
      abi: factoryAbi,
      functionName,
      args: [token],
    });
    const hash = await walletClient.writeContract(request);
    logger.info(`Graduation ${functionName} submitted for ${token}: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return true;
  }

  async function canPrepare(token, curve) {
    try {
      const [venue, supply, reserve, quote] = await Promise.all([
        publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "venueOf", args: [token] }),
        publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "supply" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "reserveAmount" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "realQuote" }),
      ]);
      if (venue === zeroAddress) throw new Error("No venue configured for this token.");
      await publicClient.readContract({ address: venue, abi: venueAbi, functionName: "check", args: [token, supply - curveSupply - reserve, quote] });
      return true;
    } catch (error) {
      logger.warn(`Venue check deferred for ${token}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function discoverLaunches() {
    const latest = await publicClient.getBlockNumber();
    while (nextBlock <= latest) {
      const ranges = [];
      for (let block = nextBlock; block <= latest && ranges.length < LOG_SCAN_CONCURRENCY; block += LOG_RANGE) {
        const toBlock = block + LOG_RANGE - 1n < latest ? block + LOG_RANGE - 1n : latest;
        ranges.push({ fromBlock: block, toBlock });
      }
      const batches = await Promise.all(ranges.map((range) => publicClient.getContractEvents({
        address: factory, abi: factoryAbi, eventName: "LaunchCreated",
        ...range, strict: true,
      })));
      for (const logs of batches) {
        for (const log of logs) {
          const token = getAddress(log.args.token);
          markets.set(token.toLowerCase(), { token, curve: getAddress(log.args.curve) });
        }
      }
      nextBlock = ranges.at(-1).toBlock + 1n;
    }
  }

  async function tick() {
    if (curveSupply === undefined) {
      curveSupply = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "curveSupply" });
    }
    await discoverLaunches();
    // Reads are independent; writes remain serial for the keeper wallet nonce.
    const entries = [...markets];
    const statuses = await mapConcurrent(entries, STATUS_CONCURRENCY, async ([, { curve }]) => {
      const [sold, graduated] = await Promise.all([
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "sold" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduated" }),
      ]);
      return { sold, graduated };
    });
    for (const [index, [key, { token, curve }]] of entries.entries()) {
      try {
        if (statuses[index].error) throw statuses[index].error;
        const { sold, graduated } = statuses[index].value;
        if (graduated) { markets.delete(key); retryAfter.delete(key); deferCount.delete(key); continue; }
        if (sold !== curveSupply) { retryAfter.delete(key); deferCount.delete(key); continue; }
        if ((retryAfter.get(key) ?? 0) > now()) continue;
        const result = await processMarket({ token, curveSupply, readState: () => readState(curve), canPrepare: () => canPrepare(token, curve), send });
        if (result.status === "graduated") {
          logger.info(`Graduated ${token} into pool ${result.pool}`);
          markets.delete(key);
          retryAfter.delete(key);
          deferCount.delete(key);
        } else if (result.status === "deferred") {
          scheduleRetry(key, token, "Graduation deferred");
        }
      } catch (error) {
        logger.error(`Graduation check failed for ${token}: ${error instanceof Error ? error.message : String(error)}`);
        scheduleRetry(key, token, "Graduation check failed");
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
  const factory = required("KEEPER_FACTORY_ADDRESS");
  const privateKey = required("KEEPER_PRIVATE_KEY");
  const chainId = Number(required("KEEPER_CHAIN_ID"));
  const deploymentBlock = BigInt(required("KEEPER_DEPLOYMENT_BLOCK"));
  const intervalMs = Number(process.env.KEEPER_POLL_INTERVAL_MS || 10_000);
  if (!isAddress(factory) || !/^0x[0-9a-fA-F]{64}$/.test(privateKey) || !Number.isSafeInteger(chainId) || chainId <= 0 || deploymentBlock < 0n || !Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("Invalid keeper configuration.");
  }
  const chain = defineChain({ id: chainId, name: "Keeper chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  if (await publicClient.getChainId() !== chainId) throw new Error("Keeper RPC is on the wrong chain.");
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const keeper = createGraduationKeeper({ publicClient, walletClient, factory: getAddress(factory), deploymentBlock });
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  console.info(`Graduation keeper started for factory ${getAddress(factory)} on chain ${chainId}.`);
  while (!stopping) {
    try { await keeper.tick(); }
    catch (error) { console.error(`Keeper sweep failed: ${error instanceof Error ? error.message : String(error)}`); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}

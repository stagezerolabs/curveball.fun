import { formatEther, getAddress, zeroAddress, type Address } from "viem";
import { launchpadAbi } from "./sdk/contracts";
import { v2CurveAbi, v2FactoryAbi } from "./sdk/v2Contracts";
import { activeChainId, activeContractVersion, activeDeploymentBlock, launchpadAddress } from "./lib/web3";
import testnetV2 from "../deployments/11155931/curveball-v2.json";
import type { Token } from "./types";

export const CURVEBALL_TESTNET_DEPLOYMENT_BLOCK = 55_002_177n;
const MAX_EVENT_QUERY_BLOCKS = 5_000n;
const EVENT_QUERY_CONCURRENCY = 3;
const EVENT_QUERY_ATTEMPTS = 6;
// The first LaunchCreated from the recorded V2 testnet factory is at this block.
// Earlier factory blocks cannot contain a launch and need no repeated RPC scan.
const TESTNET_V2_FIRST_LAUNCH_BLOCK = 56_102_377n;

async function readCreatedLogs(
  client: CreatorTokenClient,
  parameters: object,
): Promise<readonly CreatedLog[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < EVENT_QUERY_ATTEMPTS; attempt += 1) {
    try {
      return await client.getContractEvents(parameters);
    } catch (error) {
      lastError = error;
      if (attempt < EVENT_QUERY_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(500 * 2 ** attempt, 4_000)),
        );
      }
    }
  }
  throw lastError;
}

type CreatedLog = {
  args?: {
    token?: Address;
    creator?: Address;
    name?: string;
    symbol?: string;
    uri?: string;
    curve?: Address;
  };
  blockNumber?: bigint | null;
};

export type CreatorTokenClient = {
  getBlockNumber?(): Promise<bigint>;
  getContractEvents(parameters: object): Promise<readonly CreatedLog[]>;
  readContract(parameters: { functionName: string; [key: string]: unknown }): Promise<unknown>;
  getBlock(parameters: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

type Market = readonly [
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  boolean,
  Address,
];

export async function discoverCreatorTokens(
  client: CreatorTokenClient,
  creator: Address,
  version: "v1" | "v2" = activeContractVersion,
): Promise<Token[]> {
  return discoverTokens(client, { creator }, version);
}

export async function discoverAllTokens(
  client: CreatorTokenClient,
  version: "v1" | "v2" = activeContractVersion,
): Promise<Token[]> {
  return discoverTokens(client, undefined, version);
}

export async function discoverToken(
  client: CreatorTokenClient,
  token: Address,
  version: "v1" | "v2" = activeContractVersion,
): Promise<Token | null> {
  const tokens = await discoverTokens(client, { token }, version);
  return tokens[0] ?? null;
}

async function discoverTokens(
  client: CreatorTokenClient,
  args?: { creator: Address } | { token: Address },
  version: "v1" | "v2" = activeContractVersion,
): Promise<Token[]> {
  if (!launchpadAddress) return [];
  const eventQuery = {
    address: launchpadAddress,
    abi: version === "v2" ? v2FactoryAbi : launchpadAbi,
    eventName: version === "v2" ? "LaunchCreated" : "TokenCreated",
    ...(args ? { args } : {}),
    strict: true,
  };
  if (!client.getBlockNumber) {
    throw new Error("RPC client cannot report the latest block for bounded event queries.");
  }
  const latestBlock = await client.getBlockNumber();
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  const firstBlock = version === "v2" && activeChainId === testnetV2.chainId &&
    launchpadAddress.toLowerCase() === testnetV2.factory.toLowerCase() &&
    activeDeploymentBlock <= TESTNET_V2_FIRST_LAUNCH_BLOCK
      ? TESTNET_V2_FIRST_LAUNCH_BLOCK
      : activeDeploymentBlock;
  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += MAX_EVENT_QUERY_BLOCKS) {
    const toBlock =
      fromBlock + MAX_EVENT_QUERY_BLOCKS - 1n < latestBlock
        ? fromBlock + MAX_EVENT_QUERY_BLOCKS - 1n
        : latestBlock;
    ranges.push({ fromBlock, toBlock });
  }
  const logs: CreatedLog[] = [];
  let nextRange = 0;
  await Promise.all(Array.from({ length: Math.min(EVENT_QUERY_CONCURRENCY, ranges.length) }, async () => {
    while (nextRange < ranges.length) {
      const range = ranges[nextRange++];
      logs.push(...await readCreatedLogs(client, { ...eventQuery, ...range }));
    }
  }));
  if (!logs.length) return [];

  const [curveSupply, supply, initialVQ] = await Promise.all([
    client.readContract({ address: launchpadAddress, abi: version === "v2" ? v2FactoryAbi : launchpadAbi, functionName: "curveSupply" }) as Promise<bigint>,
    client.readContract({ address: launchpadAddress, abi: version === "v2" ? v2FactoryAbi : launchpadAbi, functionName: "supply" }) as Promise<bigint>,
    client.readContract({ address: launchpadAddress, abi: version === "v2" ? v2FactoryAbi : launchpadAbi, functionName: "initialVQ" }) as Promise<bigint>,
  ]);
  const terminalVirtualToken = supply - curveSupply;
  const invariant = supply * initialVQ;
  const terminalVirtualQuote = terminalVirtualToken === 0n
    ? 0n
    : (invariant + terminalVirtualToken - 1n) / terminalVirtualToken;
  const targetPrice = terminalVirtualToken === 0n
    ? null
    : Number(formatEther(terminalVirtualQuote)) / Number(formatEther(terminalVirtualToken));

  const tokens = await Promise.all(
    logs.map(async (log) => {
      const { token, creator: eventCreator, name, symbol, uri } = log.args ?? {};
      if (!token || !eventCreator || !name || !symbol || !log.blockNumber) {
        throw new Error("The launchpad returned an incomplete TokenCreated log.");
      }

      if (version === "v2") {
        const [market, block] = await Promise.all([
          client.readContract({ address: launchpadAddress, abi: v2FactoryAbi, functionName: "market", args: [token] }) as Promise<readonly [Address, Address, number, number, number, number, Address]>,
          client.getBlock({ blockNumber: log.blockNumber }),
        ]);
        const curve = market[0];
        if (curve === zeroAddress || (log.args?.curve && getAddress(log.args.curve) !== getAddress(curve))) throw new Error("Launch event does not match factory market.");
        const [sold, ready, graduated, pool, virtualQuote, virtualToken] = await Promise.all([
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "sold" }) as Promise<bigint>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "ready" }) as Promise<boolean>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "graduated" }) as Promise<boolean>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "pool" }) as Promise<Address>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "virtualQuote" }) as Promise<bigint>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "virtualToken" }) as Promise<bigint>,
        ]);
        const price = virtualToken === 0n ? null : Number(formatEther(virtualQuote)) / Number(formatEther(virtualToken));
        return {
          address: getAddress(token), creator: getAddress(eventCreator), name, symbol, graduated,
          metadataUri: uri ?? null,
          curve: getAddress(curve), feeBps: market[2], creatorShareBps: market[3], buybackShareBps: market[4], creatorTaxBps: market[5],
          pending: ready, createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
          createdBlock: log.blockNumber.toString(),
          progress: curveSupply === 0n ? 0 : Number((sold * 10_000n) / curveSupply) / 100,
          price, targetPrice, marketCap: price === null ? null : price * Number(formatEther(supply)),
          pool: pool === zeroAddress ? null : getAddress(pool), quoteSymbol: "WETH",
        } satisfies Token;
      }
      const [market, block] = await Promise.all([
        client.readContract({
          address: launchpadAddress,
          abi: launchpadAbi,
          functionName: "markets",
          args: [token],
        }) as Promise<Market>,
        client.getBlock({ blockNumber: log.blockNumber }),
      ]);
      const [, , , , sold, graduated, pending, pool] = market;
      const virtualToken = market[1];
      const virtualQuote = market[2];
      const price = virtualToken === 0n ? null : Number(formatEther(virtualQuote)) / Number(formatEther(virtualToken));
      const progress =
        curveSupply === 0n
          ? 0
          : Number((sold * 10_000n) / curveSupply) / 100;

      return {
        address: getAddress(token),
        creator: getAddress(eventCreator),
        name,
        symbol,
        metadataUri: uri ?? null,
        graduated,
        pending,
        createdBlock: log.blockNumber.toString(),
        createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
        price,
        targetPrice,
        marketCap: price === null ? null : price * Number(formatEther(supply)),
        progress,
        pool: pool === zeroAddress ? null : getAddress(pool),
        quoteSymbol: "WETH",
      } satisfies Token;
    }),
  );

  return tokens.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

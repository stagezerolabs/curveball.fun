import { formatEther, getAddress, zeroAddress, type Address } from "viem";
import { v2CurveAbi, v2FactoryAbi } from "./sdk/v2Contracts";
import { activeDeploymentBlock, launchpadAddress, legacyFactories } from "./lib/web3";
import { buildBlockRanges } from "./lib/marketChart";
import type { Token } from "./types";

const MAX_EVENT_QUERY_BLOCKS = 5_000n;
const EVENT_QUERY_CONCURRENCY = 3;

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

export async function discoverCreatorTokens(
  client: CreatorTokenClient,
  creator: Address
): Promise<Token[]> {
  return discoverTokens(client, { creator });
}

export async function discoverAllTokens(
  client: CreatorTokenClient,
  onFactoryTokens?: (tokens: Token[]) => void,
): Promise<Token[]> {
  return discoverTokens(client, undefined, onFactoryTokens);
}

export async function discoverToken(
  client: CreatorTokenClient,
  token: Address
): Promise<Token | null> {
  const tokens = await discoverTokens(client, { token });
  return tokens[0] ?? null;
}

async function discoverTokens(
  client: CreatorTokenClient,
  args?: { creator: Address } | { token: Address },
  onFactoryTokens?: (tokens: Token[]) => void,
): Promise<Token[]> {
  if (!launchpadAddress) return [];
  const deployments = [{ address: launchpadAddress, deploymentBlock: activeDeploymentBlock }, ...legacyFactories];
  const scanFactory = async (deployment: typeof deployments[number]) => {
    const tokens = await discoverTokensForFactory(client, deployment.address, deployment.deploymentBlock, args);
    onFactoryTokens?.(tokens);
    return tokens;
  };
  const current = await scanFactory(deployments[0]);
  const legacyBatches = await Promise.all(deployments.slice(1).map(scanFactory));
  return [current, ...legacyBatches].flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function discoverTokensForFactory(
  client: CreatorTokenClient,
  factoryAddress: Address,
  deploymentBlock: bigint,
  args?: { creator: Address } | { token: Address },
): Promise<Token[]> {
  const eventQuery = {
    address: factoryAddress,
    abi: v2FactoryAbi,
    eventName: "LaunchCreated",
    ...(args ? { args } : {}),
    strict: true,
  };
  if (!client.getBlockNumber) {
    throw new Error("RPC client cannot report the latest block for bounded event queries.");
  }
  const latestBlock = await client.getBlockNumber();
  const ranges = buildBlockRanges(deploymentBlock, latestBlock, MAX_EVENT_QUERY_BLOCKS);
  const logs: CreatedLog[] = [];
  let nextRange = 0;
  await Promise.all(Array.from({ length: Math.min(EVENT_QUERY_CONCURRENCY, ranges.length) }, async () => {
    while (nextRange < ranges.length) {
      const range = ranges[nextRange++];
      logs.push(...await client.getContractEvents({ ...eventQuery, ...range }));
    }
  }));
  if (!logs.length) return [];

  const [curveSupply, supply, initialVQ] = await Promise.all([
    client.readContract({ address: factoryAddress, abi: v2FactoryAbi, functionName: "curveSupply" }) as Promise<bigint>,
    client.readContract({ address: factoryAddress, abi: v2FactoryAbi, functionName: "supply" }) as Promise<bigint>,
    client.readContract({ address: factoryAddress, abi: v2FactoryAbi, functionName: "initialVQ" }) as Promise<bigint>,
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
        throw new Error("The launchpad returned an incomplete LaunchCreated log.");
      }

      const [market, block] = await Promise.all([
        client.readContract({ address: factoryAddress, abi: v2FactoryAbi, functionName: "market", args: [token] }) as Promise<readonly [Address, Address, number, number, number, number, Address]>,
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
        address: getAddress(token), factory: factoryAddress, creator: getAddress(eventCreator), name, symbol, graduated,
        metadataUri: uri ?? null,
        curve: getAddress(curve), feeBps: market[2], creatorShareBps: market[3], buybackShareBps: market[4], creatorTaxBps: market[5],
        pending: ready, createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
        createdBlock: log.blockNumber.toString(),
        progress: curveSupply === 0n ? 0 : Number((sold * 10_000n) / curveSupply) / 100,
        price, targetPrice, marketCap: price === null ? null : price * Number(formatEther(supply)),
        pool: pool === zeroAddress ? null : getAddress(pool), quoteSymbol: "WETH",
      } satisfies Token;
    }),
  );

  return tokens;
}

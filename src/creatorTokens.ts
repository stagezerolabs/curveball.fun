import { getAddress, zeroAddress, type Address } from "viem";
import { launchpadAbi } from "./sdk/contracts";
import { v2CurveAbi, v2FactoryAbi } from "./sdk/v2Contracts";
import { activeContractVersion, activeDeploymentBlock, launchpadAddress } from "./lib/web3";
import type { Token } from "./types";

export const CURVEBALL_TESTNET_DEPLOYMENT_BLOCK = 55_002_177n;
const MAX_EVENT_QUERY_BLOCKS = 5_000n;

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
  const latestBlock = await client.getBlockNumber?.();
  const logs: CreatedLog[] = [];

  if (latestBlock === undefined) {
    logs.push(
      ...(await client.getContractEvents({
        ...eventQuery,
        fromBlock: activeDeploymentBlock,
        toBlock: "latest",
      })),
    );
  } else {
    for (
      let fromBlock = activeDeploymentBlock;
      fromBlock <= latestBlock;
      fromBlock += MAX_EVENT_QUERY_BLOCKS
    ) {
      const toBlock =
        fromBlock + MAX_EVENT_QUERY_BLOCKS - 1n < latestBlock
          ? fromBlock + MAX_EVENT_QUERY_BLOCKS - 1n
          : latestBlock;
      logs.push(
        ...(await client.getContractEvents({
          ...eventQuery,
          fromBlock,
          toBlock,
        })),
      );
    }
  }
  if (!logs.length) return [];

  const curveSupply = (await client.readContract({
    address: launchpadAddress,
    abi: launchpadAbi,
    functionName: "curveSupply",
  })) as bigint;

  const tokens = await Promise.all(
    logs.map(async (log) => {
      const { token, creator: eventCreator, name, symbol } = log.args ?? {};
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
        const [sold, ready, graduated, pool] = await Promise.all([
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "sold" }) as Promise<bigint>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "ready" }) as Promise<boolean>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "graduated" }) as Promise<boolean>,
          client.readContract({ address: curve, abi: v2CurveAbi, functionName: "pool" }) as Promise<Address>,
        ]);
        return {
          address: getAddress(token), creator: getAddress(eventCreator), name, symbol, graduated,
          pending: ready, createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
          progress: curveSupply === 0n ? 0 : Number((sold * 10_000n) / curveSupply) / 100,
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
      const progress =
        curveSupply === 0n
          ? 0
          : Number((sold * 10_000n) / curveSupply) / 100;

      return {
        address: getAddress(token),
        creator: getAddress(eventCreator),
        name,
        symbol,
        graduated,
        pending,
        createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
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

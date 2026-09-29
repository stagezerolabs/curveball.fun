import { getAddress, zeroAddress, type Address } from "viem";
import { launchpadAbi } from "./sdk/contracts";
import { activeDeploymentBlock, launchpadAddress } from "./lib/web3";
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
): Promise<Token[]> {
  return discoverTokens(client, { creator });
}

export async function discoverAllTokens(
  client: CreatorTokenClient,
): Promise<Token[]> {
  return discoverTokens(client);
}

export async function discoverToken(
  client: CreatorTokenClient,
  token: Address,
): Promise<Token | null> {
  const tokens = await discoverTokens(client, { token });
  return tokens[0] ?? null;
}

async function discoverTokens(
  client: CreatorTokenClient,
  args?: { creator: Address } | { token: Address },
): Promise<Token[]> {
  if (!launchpadAddress) return [];
  const eventQuery = {
    address: launchpadAddress,
    abi: launchpadAbi,
    eventName: "TokenCreated",
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

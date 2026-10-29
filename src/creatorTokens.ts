import { formatEther, getAddress, zeroAddress, type Address } from "viem";
import { curveLaunchpadAbi } from "./sdk/contracts";
import { CURVE_SUPPLY, MARKET_STATES, TOKEN_SUPPLY } from "./sdk/sdk";
import { activeDeploymentBlock, launchpadAddress } from "./lib/web3";
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
  };
  blockNumber?: bigint | null;
};

export type CreatorTokenClient = {
  getBlockNumber?(): Promise<bigint>;
  getContractEvents(parameters: object): Promise<readonly CreatedLog[]>;
  readContract(parameters: {
    functionName: string;
    [key: string]: unknown;
  }): Promise<unknown>;
  getBlock(parameters: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

export async function discoverCreatorTokens(
  client: CreatorTokenClient,
  creator: Address,
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
  token: Address,
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
  const tokens = await discoverTokensForFactory(
    client,
    launchpadAddress,
    activeDeploymentBlock,
    args,
  );
  onFactoryTokens?.(tokens);
  return tokens.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** The launchpad's market struct, as `market(token)` returns it. */
export type LaunchpadMarket = Readonly<{
  creator: Address;
  feeBps: number;
  creatorShareBps: number;
  buybackShareBps: number;
  taxBps: number;
  state: number;
  virtualToken: bigint;
  virtualQuote: bigint;
  initialVirtualQuote: bigint;
  realQuote: bigint;
  reserveTokens: bigint;
  readyAt: number;
  pool: Address;
}>;

/** The token fields that follow from a market's on-chain state. */
export function marketFields(market: LaunchpadMarket) {
  const lifecycle = MARKET_STATES[market.state] ?? "none";
  const sold = TOKEN_SUPPLY - market.virtualToken;
  const terminalVirtualToken = TOKEN_SUPPLY - CURVE_SUPPLY;
  // The curve ends where virtualToken reaches S − C; k = S · initialVirtualQuote is fixed until graduation.
  const terminalVirtualQuote =
    (TOKEN_SUPPLY * market.initialVirtualQuote + terminalVirtualToken - 1n) /
    terminalVirtualToken;
  const price =
    market.virtualToken === 0n
      ? null
      : Number(formatEther(market.virtualQuote)) /
        Number(formatEther(market.virtualToken));
  return {
    lifecycle,
    graduated: lifecycle === "graduated",
    pending: lifecycle === "ready",
    readyAt: market.readyAt === 0 ? null : Number(market.readyAt),
    feeBps: market.feeBps,
    creatorShareBps: market.creatorShareBps,
    buybackShareBps: market.buybackShareBps,
    creatorTaxBps: market.taxBps,
    reserveTokens: market.reserveTokens.toString(),
    progress: Number((sold * 10_000n) / CURVE_SUPPLY) / 100,
    supply: TOKEN_SUPPLY.toString(),
    curveSupply: CURVE_SUPPLY.toString(),
    price,
    targetPrice:
      Number(formatEther(terminalVirtualQuote)) /
      Number(formatEther(terminalVirtualToken)),
    marketCap:
      price === null ? null : price * Number(formatEther(TOKEN_SUPPLY)),
    curveLiquidityWeth:
      lifecycle === "graduated" ? null : Number(formatEther(market.realQuote)),
    graduationTargetWeth: formatEther(
      terminalVirtualQuote - market.initialVirtualQuote,
    ),
    initialVirtualQuote: market.initialVirtualQuote.toString(),
    pool: market.pool === zeroAddress ? null : getAddress(market.pool),
  } satisfies Partial<Token>;
}

export function readMarket(
  client: Pick<CreatorTokenClient, "readContract">,
  launchpad: Address,
  token: Address,
) {
  return client.readContract({
    address: launchpad,
    abi: curveLaunchpadAbi,
    functionName: "market",
    args: [token],
  }) as Promise<LaunchpadMarket>;
}

async function discoverTokensForFactory(
  client: CreatorTokenClient,
  launchpad: Address,
  deploymentBlock: bigint,
  args?: { creator: Address } | { token: Address },
): Promise<Token[]> {
  const eventQuery = {
    address: launchpad,
    abi: curveLaunchpadAbi,
    eventName: "LaunchCreated",
    ...(args ? { args } : {}),
    strict: true,
  };
  if (!client.getBlockNumber) {
    throw new Error(
      "RPC client cannot report the latest block for bounded event queries.",
    );
  }
  const latestBlock = await client.getBlockNumber();
  const ranges = buildBlockRanges(
    deploymentBlock,
    latestBlock,
    MAX_EVENT_QUERY_BLOCKS,
  );
  const logs: CreatedLog[] = [];
  let nextRange = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(EVENT_QUERY_CONCURRENCY, ranges.length) },
      async () => {
        while (nextRange < ranges.length) {
          const range = ranges[nextRange++];
          logs.push(
            ...(await client.getContractEvents({ ...eventQuery, ...range })),
          );
        }
      },
    ),
  );
  if (!logs.length) return [];

  return Promise.all(
    logs.map(async (log) => {
      const {
        token,
        creator: eventCreator,
        name,
        symbol,
        uri,
      } = log.args ?? {};
      if (!token || !eventCreator || !name || !symbol || !log.blockNumber) {
        throw new Error(
          "The launchpad returned an incomplete LaunchCreated log.",
        );
      }
      const [market, block] = await Promise.all([
        readMarket(client, launchpad, token),
        client.getBlock({ blockNumber: log.blockNumber }),
      ]);
      if (
        market.creator === zeroAddress ||
        getAddress(market.creator) !== getAddress(eventCreator)
      ) {
        throw new Error("Launch event does not match the launchpad's market.");
      }
      return {
        address: getAddress(token),
        factory: launchpad,
        creator: getAddress(eventCreator),
        name,
        symbol,
        metadataUri: uri ?? null,
        createdAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
        createdBlock: log.blockNumber.toString(),
        quoteSymbol: "WETH",
        ...marketFields(market),
      } satisfies Token;
    }),
  );
}

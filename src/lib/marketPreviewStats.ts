import type { Address, Hash } from "viem";
import { curveLaunchpadAbi } from "../sdk/contracts";
import type { Token } from "../types";
import {
  buildBlockRanges,
  parseCreatedBlock,
  tradeLogToPoint,
  type TradeLogValues,
} from "./marketChart";

const MAX_EVENT_QUERY_BLOCKS = 5_000n;
const EVENT_QUERY_CONCURRENCY = 3;
const BLOCK_QUERY_CONCURRENCY = 6;

let tradeSampleCache: {
  marketSignature: string;
  lastBlock: bigint;
  samples: MarketTradeSample[];
} | null = null;

export type MarketPreviewStats = {
  athMarketCap: number | null;
  transactions: number;
  traders: number;
  volume24h: number;
  change1h: number | null;
  change6h: number | null;
  change24h: number | null;
};

export type MarketPreviewStatsByToken = Record<string, MarketPreviewStats>;

export type MarketTradeSample = {
  token: Address;
  trader?: Address;
  transactionHash?: Hash;
  eventId: string;
  timestamp: number;
  price: number;
  volume: number;
  isBuy?: boolean;
  /** What the trader paid on a buy or received on a sell, matching the backend's net_trader_quote. */
  quoteWei?: bigint;
};

type TradeLog = {
  args?: TradeLogValues & {
    token?: Address;
    trader?: Address;
  };
  blockNumber?: bigint | null;
  logIndex?: number;
  transactionHash?: Hash;
};

export type MarketPreviewStatsClient = {
  getBlockNumber(): Promise<bigint>;
  getContractEvents(parameters: object): Promise<readonly TradeLog[]>;
  getBlock(parameters: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

function percentChange(
  samples: readonly MarketTradeSample[],
  currentPrice: number | null | undefined,
  seconds: number,
  now: number,
) {
  if (
    currentPrice == null ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    !samples.length
  )
    return null;
  const cutoff = now - seconds;
  const prior = samples.findLast((sample) => sample.timestamp <= cutoff);
  const baseline = prior ?? samples[0];
  if (!baseline || baseline.price <= 0) return null;
  const change = (currentPrice / baseline.price - 1) * 100;
  return Number.isFinite(change) ? change : null;
}

export function summarizeMarketPreviewStats(
  tokens: readonly Pick<Token, "address" | "price" | "marketCap">[],
  samples: readonly MarketTradeSample[],
  now = Date.now() / 1_000,
): MarketPreviewStatsByToken {
  const byToken = new Map<string, MarketTradeSample[]>();
  for (const sample of samples) {
    const key = sample.token.toLowerCase();
    const tokenSamples = byToken.get(key) ?? [];
    tokenSamples.push(sample);
    byToken.set(key, tokenSamples);
  }

  return Object.fromEntries(
    tokens.map((token) => {
      const key = token.address.toLowerCase();
      const tokenSamples = (byToken.get(key) ?? [])
        .filter((sample) => Number.isFinite(sample.price) && sample.price > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
      const currentPrice =
        token.price != null && Number.isFinite(token.price) && token.price > 0
          ? token.price
          : null;
      let athPrice = currentPrice;
      for (const sample of tokenSamples) {
        athPrice =
          athPrice == null ? sample.price : Math.max(athPrice, sample.price);
      }
      const supply =
        currentPrice && token.marketCap != null
          ? token.marketCap / currentPrice
          : null;
      const athMarketCap =
        athPrice != null && supply != null && Number.isFinite(supply)
          ? athPrice * supply
          : (token.marketCap ?? null);
      const transactionIds = new Set(
        tokenSamples.map((sample) => sample.transactionHash ?? sample.eventId),
      );
      const traders = new Set(
        tokenSamples.flatMap((sample) =>
          sample.trader ? [sample.trader.toLowerCase()] : [],
        ),
      );

      return [
        key,
        {
          athMarketCap,
          transactions: transactionIds.size,
          traders: traders.size,
          volume24h: tokenSamples.reduce(
            (total, sample) =>
              sample.timestamp >= now - 86_400 ? total + sample.volume : total,
            0,
          ),
          change1h: percentChange(tokenSamples, currentPrice, 3_600, now),
          change6h: percentChange(tokenSamples, currentPrice, 21_600, now),
          change24h: percentChange(tokenSamples, currentPrice, 86_400, now),
        } satisfies MarketPreviewStats,
      ];
    }),
  );
}

export async function loadMarketPreviewStats(
  client: MarketPreviewStatsClient,
  tokens: readonly Token[],
  deploymentBlock: bigint,
): Promise<MarketPreviewStatsByToken> {
  return summarizeMarketPreviewStats(
    tokens,
    await loadMarketTradeSamples(client, tokens, deploymentBlock),
  );
}

/** Reads every curve Trade for the given markets, refreshing the shared cache from its last block. */
export async function loadMarketTradeSamples(
  client: MarketPreviewStatsClient,
  tokens: readonly Token[],
  deploymentBlock: bigint,
): Promise<MarketTradeSample[]> {
  const markets = tokens.filter(
    (token): token is Token & { factory: Address } => Boolean(token.factory),
  );
  if (!markets.length) return [];
  const launchpads = [...new Set(markets.map((token) => token.factory))];

  const latestBlock = await client.getBlockNumber();
  const marketSignature = markets
    .map(
      (token) =>
        `${token.address.toLowerCase()}:${token.factory.toLowerCase()}:${token.createdBlock ?? deploymentBlock}`,
    )
    .sort()
    .join("|");
  const cached =
    tradeSampleCache?.marketSignature === marketSignature &&
    tradeSampleCache.lastBlock <= latestBlock
      ? tradeSampleCache
      : null;
  const firstMarketBlock = markets.reduce((earliest, token) => {
    const createdBlock = parseCreatedBlock(token.createdBlock, deploymentBlock);
    return createdBlock < earliest ? createdBlock : earliest;
  }, latestBlock);
  const fromBlock = cached ? cached.lastBlock + 1n : firstMarketBlock;
  const ranges = buildBlockRanges(
    fromBlock,
    latestBlock,
    MAX_EVENT_QUERY_BLOCKS,
  );
  const logs: TradeLog[] = [];
  let nextRange = 0;
  const eventQuery = {
    address: launchpads,
    abi: curveLaunchpadAbi,
    eventName: "Trade",
    args: { token: markets.map((token) => token.address) },
    strict: true,
  };

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

  const blockNumbers = [
    ...new Set(
      logs.flatMap((log) => (log.blockNumber == null ? [] : [log.blockNumber])),
    ),
  ];
  const timestamps = new Map<bigint, number>();
  let nextBlock = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(BLOCK_QUERY_CONCURRENCY, blockNumbers.length) },
      async () => {
        while (nextBlock < blockNumbers.length) {
          const blockNumber = blockNumbers[nextBlock++];
          const block = await client.getBlock({ blockNumber });
          timestamps.set(blockNumber, Number(block.timestamp));
        }
      },
    ),
  );

  const newSamples = logs.flatMap((log): MarketTradeSample[] => {
    const { token, trader, isBuy, quoteAmount } = log.args ?? {};
    if (!token || log.blockNumber == null) return [];
    const point = tradeLogToPoint(log.args, timestamps.get(log.blockNumber));
    if (!point || !Number.isFinite(point.price)) return [];
    return [
      {
        token,
        trader,
        transactionHash: log.transactionHash,
        eventId: `${log.blockNumber}:${log.logIndex ?? 0}`,
        isBuy,
        quoteWei: quoteAmount,
        ...point,
      },
    ];
  });

  const samples = [...(cached?.samples ?? []), ...newSamples];
  tradeSampleCache = { marketSignature, lastBlock: latestBlock, samples };

  return samples;
}

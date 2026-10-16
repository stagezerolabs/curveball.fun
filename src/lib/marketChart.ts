import { formatEther, isAddress, type Address, type Hash } from "viem";

export type TradeActivity = {
  trader: Address;
  isBuy: boolean;
  tokenAmount: bigint;
  quoteAmount: bigint;
  timestamp: number;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
};

export function tradeLogToActivity(
  log: {
    args?: { trader?: string; isBuy?: boolean; tokenAmount?: bigint; netTraderQuote?: bigint };
    blockNumber?: bigint | null;
    logIndex?: number;
    transactionHash?: string;
  },
  timestamp: number | undefined,
): TradeActivity | null {
  const { trader, isBuy, tokenAmount, netTraderQuote } = log.args ?? {};
  if (!trader || !isAddress(trader) || typeof isBuy !== "boolean" || tokenAmount === undefined ||
      netTraderQuote === undefined || timestamp === undefined ||
      log.blockNumber == null || log.logIndex === undefined || !log.transactionHash) return null;
  return {
    trader,
    isBuy,
    tokenAmount,
    quoteAmount: netTraderQuote,
    timestamp,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash as Hash,
  };
}

export type TradePoint = {
  timestamp: number;
  price: number;
  volume: number;
};

export type MarketPriceChange = {
  percent: number;
  period: "24h" | "since first trade";
};

export function calculatePriceChange(
  points: readonly TradePoint[],
  currentPrice: number | null | undefined,
  now = Date.now() / 1000,
): MarketPriceChange | null {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const ordered = points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!ordered.length) return null;

  const cutoff = now - 86_400;
  const prior = ordered.findLast((point) => point.timestamp <= cutoff);
  const baseline = prior ?? ordered[0];
  const percent = (currentPrice / baseline.price - 1) * 100;
  if (!Number.isFinite(percent)) return null;
  return { percent, period: prior ? "24h" : "since first trade" };
}

export type TradeLogValues = {
  grossCurveQuote?: bigint;
  vQAfter?: bigint;
  vTAfter?: bigint;
};

export function parseCreatedBlock(value: string | undefined, fallback: bigint) {
  if (!value) return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

export function tradeLogToPoint(
  values: TradeLogValues | undefined,
  timestamp: number | undefined,
): TradePoint | null {
  const { vQAfter, vTAfter } = values ?? {};
  const quoteVolume = values?.grossCurveQuote;
  if (!timestamp || !vQAfter || !vTAfter || !quoteVolume) return null;
  const virtualQuote = Number(formatEther(vQAfter));
  const virtualToken = Number(formatEther(vTAfter));
  if (virtualToken <= 0) return null;
  return {
    timestamp,
    price: virtualQuote / virtualToken,
    volume: Number(formatEther(quoteVolume)),
  };
}

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function buildBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  rangeSize: bigint,
) {
  if (rangeSize <= 0n || fromBlock > toBlock) return [];
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += rangeSize) {
    ranges.push({
      fromBlock: start,
      toBlock: start + rangeSize - 1n < toBlock
        ? start + rangeSize - 1n
        : toBlock,
    });
  }
  return ranges;
}

export function buildCandles(
  trades: readonly TradePoint[],
  intervalSeconds: number,
): MarketCandle[] {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return [];

  const candles = new Map<number, MarketCandle>();
  const validTrades = trades
    .filter(
      (trade) =>
        Number.isFinite(trade.timestamp) &&
        Number.isFinite(trade.price) &&
        trade.price > 0 &&
        Number.isFinite(trade.volume) &&
        trade.volume >= 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of validTrades) {
    const time = Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;
    const current = candles.get(time);
    if (!current) {
      candles.set(time, {
        time,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.volume,
      });
      continue;
    }
    current.high = Math.max(current.high, trade.price);
    current.low = Math.min(current.low, trade.price);
    current.close = trade.price;
    current.volume += trade.volume;
  }

  return [...candles.values()];
}

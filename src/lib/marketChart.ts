import { formatEther } from "viem";

export type TradePoint = {
  timestamp: number;
  price: number;
  volume: number;
};

export type TradeLogValues = {
  quoteAmount?: bigint;
  grossCurveQuote?: bigint;
  vQAfter?: bigint;
  vTAfter?: bigint;
};

export async function withRetry<T>(
  request: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 250,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && baseDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
}

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
  const quoteVolume = values?.grossCurveQuote ?? values?.quoteAmount;
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

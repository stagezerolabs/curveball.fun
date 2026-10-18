import { formatEther, getAddress, type Address, type Hash } from "viem";
import type { MarketCandle, MarketPriceChange, TradeActivity } from "../lib/marketChart";
import type { MarketPreviewStatsByToken } from "../lib/marketPreviewStats";
import { socialApiBaseUrl } from "../social/api";
import { launchpadAddress } from "../lib/web3";
import type { Token } from "../types";

type CandleRow = {
  bucketStart: string;
  openPriceX18: string;
  highPriceX18: string;
  lowPriceX18: string;
  closePriceX18: string;
  grossQuoteVolume: string;
};

type TradeRow = {
  participantAddress: Address;
  participantRole: "trader" | "recipient";
  executionSenderAddress: Address | null;
  venueType: "curve" | "pool";
  venueAddress: Address;
  side: "buy" | "sell";
  walletQuoteAmount: string;
  tokenAmount: string;
  transactionHash: Hash;
  blockNumber: string;
  logIndex: number;
  blockTimestamp: string;
};

type MarketRow = {
  factoryAddress: Address;
  tokenAddress: Address;
  curveAddress: Address;
  creatorAddress: Address;
  name: string;
  symbol: string;
  metadataUri: string;
  imageUrl: string | null;
  state: "live" | "sold_out" | "ready" | "deferred" | "graduated";
  isGraduated: boolean;
  poolAddress: Address | null;
  launchedAt: string;
  launchBlock: string;
  policy: {
    totalSupply: string | null;
    curveSupply: string | null;
    reserveAmount: string | null;
    initialVirtualQuote: string | null;
    graduationTargetQuote: string | null;
    feeBps: number | null;
    creatorFeeShareBps: number | null;
    buybackFeeShareBps: number | null;
    creatorTaxBps: number | null;
  };
  metrics: {
    virtualQuote: string | null;
    virtualToken: string | null;
    sold: string;
    currentPriceX18: string | null;
  };
};

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!socialApiBaseUrl) throw new Error("Curveball data service is not configured.");
  const response = await fetch(`${socialApiBaseUrl}${path}`, { credentials: "include", signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Data request failed (${response.status}).`);
  return payload as T;
}

function tokenSupply(token: Token) {
  if (token.supply && /^\d+$/.test(token.supply)) return Number(formatEther(BigInt(token.supply)));
  if (token.price && token.marketCap) return token.marketCap / token.price;
  return null;
}

async function marketRowToToken(row: MarketRow): Promise<Token> {
  const supply = row.policy.totalSupply ? BigInt(row.policy.totalSupply) : null;
  const curveSupply = row.policy.curveSupply ? BigInt(row.policy.curveSupply) : null;
  const sold = BigInt(row.metrics.sold || "0");
  const price = row.metrics.currentPriceX18 ? Number(formatEther(BigInt(row.metrics.currentPriceX18))) : null;
  const supplyAmount = supply === null ? null : Number(formatEther(supply));
  const terminalVirtualToken = supply !== null && curveSupply !== null ? supply - curveSupply : null;
  const terminalVirtualQuote = row.policy.initialVirtualQuote && row.policy.graduationTargetQuote
    ? BigInt(row.policy.initialVirtualQuote) + BigInt(row.policy.graduationTargetQuote)
    : null;
  const targetPrice = terminalVirtualToken && terminalVirtualQuote
    ? Number(formatEther(terminalVirtualQuote)) / Number(formatEther(terminalVirtualToken))
    : null;
  return {
    address: getAddress(row.tokenAddress),
    factory: getAddress(row.factoryAddress || launchpadAddress!),
    name: row.name,
    symbol: row.symbol,
    creator: getAddress(row.creatorAddress),
    graduated: row.isGraduated,
    pending: row.state === "sold_out" || row.state === "ready" || row.state === "deferred",
    curve: getAddress(row.curveAddress),
    feeBps: row.policy.feeBps,
    creatorTaxBps: row.policy.creatorTaxBps,
    creatorShareBps: row.policy.creatorFeeShareBps,
    buybackShareBps: row.policy.buybackFeeShareBps,
    createdBlock: row.launchBlock,
    createdAt: row.launchedAt,
    price,
    targetPrice,
    graduationTargetWeth: row.policy.graduationTargetQuote ? formatEther(BigInt(row.policy.graduationTargetQuote)) : null,
    marketCap: price === null || supplyAmount === null ? null : price * supplyAmount,
    progress: curveSupply && curveSupply > 0n ? Number(sold * 10_000n / curveSupply) / 100 : 0,
    supply: row.policy.totalSupply,
    curveSupply: row.policy.curveSupply,
    imageUrl: row.imageUrl,
    metadataUri: row.metadataUri || null,
    pool: row.poolAddress ? getAddress(row.poolAddress) : null,
    mockVenue: false,
    quoteSymbol: "WETH",
  };
}

export async function fetchMarkets(signal?: AbortSignal): Promise<Token[]> {
  const rows: MarketRow[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ tab: "all", limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const page: { items: MarketRow[]; nextCursor: string | null } = await request(`/v1/markets?${query}`, signal);
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return Promise.all(rows.map(marketRowToToken));
}

export async function fetchMarket(tokenAddress: Address, signal?: AbortSignal): Promise<Token | null> {
  try {
    const row = await request<MarketRow>(`/v1/markets/${tokenAddress}`, signal);
    return marketRowToToken(row);
  } catch (error) {
    if (error instanceof Error && error.message === "Market not found.") return null;
    throw error;
  }
}

export async function fetchCreatorMarkets(creator: Address, signal?: AbortSignal): Promise<Token[]> {
  const tokens = await fetchMarkets(signal);
  return tokens.filter((token) => token.creator.toLowerCase() === creator.toLowerCase());
}

export async function fetchMarketCandles(token: Token, interval: number, signal?: AbortSignal): Promise<MarketCandle[]> {
  const result = await request<{ items: CandleRow[] }>(
    `/v1/markets/${token.address}/candles?interval=${interval}&limit=2000`,
    signal,
  );
  const supply = tokenSupply(token);
  if (!supply || !Number.isFinite(supply)) return [];
  return result.items.map((row) => ({
    time: Math.floor(Date.parse(row.bucketStart) / 1_000),
    open: Number(formatEther(BigInt(row.openPriceX18))) * supply,
    high: Number(formatEther(BigInt(row.highPriceX18))) * supply,
    low: Number(formatEther(BigInt(row.lowPriceX18))) * supply,
    close: Number(formatEther(BigInt(row.closePriceX18))) * supply,
    volume: Number(formatEther(BigInt(row.grossQuoteVolume))),
  }));
}

export async function fetchMarketTrades(tokenAddress: Address, signal?: AbortSignal): Promise<TradeActivity[]> {
  const result = await request<{ items: TradeRow[] }>(`/v1/markets/${tokenAddress}/trades?limit=100`, signal);
  return result.items.map((row) => ({
    trader: getAddress(row.participantAddress),
    participantRole: row.participantRole,
    venue: row.venueType,
    venueAddress: getAddress(row.venueAddress),
    executionSender: row.executionSenderAddress ? getAddress(row.executionSenderAddress) : undefined,
    isBuy: row.side === "buy",
    tokenAmount: BigInt(row.tokenAmount),
    quoteAmount: BigInt(row.walletQuoteAmount),
    timestamp: Math.floor(Date.parse(row.blockTimestamp) / 1_000),
    blockNumber: BigInt(row.blockNumber),
    logIndex: row.logIndex,
    transactionHash: row.transactionHash,
  }));
}

export async function fetchMarketHolders(tokenAddress: Address, atBlock: bigint, signal?: AbortSignal): Promise<{
  eligibleSupply: bigint;
  items: Array<{ address: Address; balance: bigint }>;
}> {
  const result = await request<{ eligibleSupply: string; items: Array<{ address: Address; balance: string }> }>(
    `/v1/markets/${tokenAddress}/holders?atBlock=${atBlock}&limit=500`,
    signal,
  );
  return {
    eligibleSupply: BigInt(result.eligibleSupply),
    items: result.items.map((holder) => ({ address: getAddress(holder.address), balance: BigInt(holder.balance) })),
  };
}

export function fetchProtocolStats(signal?: AbortSignal) {
  return request<{
    markets: number;
    graduated: number;
    grossQuoteVolume: string;
    walletCashTurnover: string;
    traders: number;
    creatorFeesClaimed: string;
    buybackQuoteSpent: string;
    poolQuoteFees: string;
  }>("/v1/protocol/stats", signal);
}

export function candlePriceChange(candles: readonly MarketCandle[], now = Date.now() / 1_000): MarketPriceChange | null {
  if (!candles.length) return null;
  const latest = candles[candles.length - 1];
  const prior = candles.findLast((candle) => candle.time <= now - 86_400);
  const baseline = prior ?? candles[0];
  if (!latest || !baseline || baseline.close <= 0) return null;
  const percent = (latest.close / baseline.close - 1) * 100;
  return Number.isFinite(percent) ? { percent, period: prior ? "24h" : "since first trade" } : null;
}

export async function fetchMarketPreviewStats(tokens: readonly Token[], signal?: AbortSignal): Promise<MarketPreviewStatsByToken> {
  const result = await request<{ items: Array<{
    tokenAddress: Address;
    policy: { totalSupply: string | null };
    metrics: {
      tradeCount: number;
      uniqueTraderCount: number;
      recentGrossQuoteVolume: string;
      athPriceX18: string | null;
      change1hBps: number | null;
      change6hBps: number | null;
      change24hBps: number | null;
    };
  }> }>("/v1/markets?tab=all&limit=50", signal);
  const byAddress = new Map(result.items.map((item) => [item.tokenAddress.toLowerCase(), item]));
  return Object.fromEntries(tokens.map((token) => {
    const item = byAddress.get(token.address.toLowerCase());
    const supply = item?.policy.totalSupply ? Number(formatEther(BigInt(item.policy.totalSupply))) : tokenSupply(token);
    const athPrice = item?.metrics.athPriceX18 ? Number(formatEther(BigInt(item.metrics.athPriceX18))) : null;
    return [token.address.toLowerCase(), {
      athMarketCap: supply && athPrice ? supply * athPrice : token.marketCap ?? null,
      transactions: item?.metrics.tradeCount ?? 0,
      traders: item?.metrics.uniqueTraderCount ?? 0,
      volume24h: item ? Number(formatEther(BigInt(item.metrics.recentGrossQuoteVolume))) : 0,
      change1h: item?.metrics.change1hBps == null ? null : item.metrics.change1hBps / 100,
      change6h: item?.metrics.change6hBps == null ? null : item.metrics.change6hBps / 100,
      change24h: item?.metrics.change24hBps == null ? null : item.metrics.change24hBps / 100,
    }];
  }));
}

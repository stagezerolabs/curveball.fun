import type { Address } from "viem";

export type Navigate = (id: string, params?: Record<string, string>) => void;

export type Token = {
  address: Address;
  name: string;
  symbol: string;
  creator: Address;
  graduated: boolean;
  pending?: boolean;
  curve?: Address | null;
  feeBps?: number | null;
  creatorTaxBps?: number | null;
  creatorShareBps?: number | null;
  buybackShareBps?: number | null;
  createdAt: string;
  price?: number | null;
  marketCap?: number | null;
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  ethUsd?: number | null;
  usdUpdatedAt?: string | null;
  usdStale?: boolean;
  progress?: number | null;
  imageUrl?: string | null;
  pool?: Address | null;
  // Market telemetry the API does not serve yet. Every consumer must treat these
  // as absent — the UI renders "—" or hides the slot rather than faking a value.
  change24h?: number | null;
  volume24h?: number | null;
  holders?: number | null;
  liquidity?: number | null;
  peakMarketCap?: number | null;
  peakMarketCapUsd?: number | null;
  quoteSymbol?: string | null;
  priceHistory?: number[] | null;
  description?: string | null;
  website?: string | null;
  xHandle?: string | null;
  telegram?: string | null;
};

export type Trade = {
  id: string;
  side: "buy" | "sell";
  amount: string;
  quote: string;
  tx: string;
  trader?: string;
  tradedAt?: string | null;
};

export type TradePage = {
  rows: Trade[];
  total: number;
  page: number;
  limit: number;
};

export type Candle = { t: string; price: number };

export type LaunchpadConfig = {
  contractVersion?: "v1" | "v2";
  chainId?: number;
  launchpadAddress?: string | null;
  quoteSymbol: string | null;
  quoteToken: string | null;
  targetPrice: number | null;
  creatorShareBps: number | null;
  treasury: string | null;
  locker: string | null;
  escrow?: string | null;
  vault?: string | null;
};

export type CandleRange = "5min" | "1h" | "6h" | "1D" | "all";

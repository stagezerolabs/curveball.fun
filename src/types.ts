import type { Address } from "viem";
import type { MarketLifecycle } from "./sdk/sdk";

export type Navigate = (id: string, params?: Record<string, string>) => void;

export type Token = {
  address: Address;
  factory?: Address;
  name: string;
  symbol: string;
  creator: Address;
  graduated: boolean;
  /** Sold out and waiting for `graduate`; the same as `lifecycle === "ready"`. */
  pending?: boolean;
  indexing?: boolean;
  lifecycle?: MarketLifecycle;
  /** Unix seconds when the curve sold out; the abort timeout runs from here. */
  readyAt?: number | null;
  reserveTokens?: string | null;
  feeBps?: number | null;
  creatorTaxBps?: number | null;
  creatorShareBps?: number | null;
  buybackShareBps?: number | null;
  createdBlock?: string;
  createdAt: string;
  price?: number | null;
  targetPrice?: number | null;
  graduationTargetWeth?: string | null;
  marketCap?: number | null;
  progress?: number | null;
  supply?: string | null;
  curveSupply?: string | null;
  imageUrl?: string | null;
  metadataUri?: string | null;
  pool?: Address | null;
  quoteSymbol?: string | null;
  description?: string | null;
  website?: string | null;
  xHandle?: string | null;
  telegram?: string | null;
};

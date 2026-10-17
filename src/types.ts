import type { Address } from "viem";

export type Navigate = (id: string, params?: Record<string, string>) => void;

export type Token = {
  address: Address;
  factory?: Address;
  name: string;
  symbol: string;
  creator: Address;
  graduated: boolean;
  pending?: boolean;
  indexing?: boolean;
  curve?: Address | null;
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
  mockVenue?: boolean;
  quoteSymbol?: string | null;
  description?: string | null;
  website?: string | null;
  xHandle?: string | null;
  telegram?: string | null;
};

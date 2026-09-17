import type { Address } from "viem";

export type Navigate = (id: string, params?: Record<string, string>) => void;

export type Token = {
  address: Address;
  name: string;
  symbol: string;
  creator: Address;
  graduated: boolean;
  createdAt: string;
  price?: number | null;
  marketCap?: number | null;
  progress?: number | null;
  imageUrl?: string | null;
  pool?: Address | null;
};

export type Trade = {
  id: string;
  side: "buy" | "sell";
  amount: string;
  quote: string;
  tx: string;
};

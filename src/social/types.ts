import type { Address } from "viem";

export type TraderStats = {
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  volumeWei: string;
  realizedPnlWei: string;
  realizedReturnPct: number | null;
  marketsTraded: number;
  firstTrade: string | null;
  lastTrade: string | null;
};

export type SocialTrade = {
  id: string;
  traderAddress: Address;
  isBuy: boolean;
  quoteAmountWei: string;
  tokenAmountWei: string;
  virtualQuoteAfter: string;
  virtualTokenAfter: string;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockTimestamp: string;
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  curveAddress: Address;
  displayName: string | null;
  note: string | null;
  reactionCount: number;
  reacted: boolean;
  followerCount: number;
  isFollowed: boolean;
};

export type TraderPosition = {
  token_address: Address;
  token_name: string;
  token_symbol: string;
  balance_wei: string;
  known_basis_balance_wei: string;
  exact_balance_indexed: boolean;
  invested_wei: string;
  proceeds_wei: string;
  virtual_quote_after: string;
  virtual_token_after: string;
};

export type TraderProfile = {
  address: Address;
  claimed: boolean;
  displayName: string | null;
  bio: string;
  discoverable: boolean;
  claimedAt: string | null;
  stats: TraderStats;
  followers: number;
  following: number;
  isFollowed: boolean;
  isBlocked: boolean;
  positions: TraderPosition[];
};

export type NotificationItem = {
  id: string;
  kind: "followed_buy" | "followed_sell" | "curve_milestone";
  actor_address: Address | null;
  payload: {
    tokenAddress?: Address;
    transactionHash?: `0x${string}`;
    tokenName?: string;
    tokenSymbol?: string;
    actorDisplayName?: string;
    milestone?: 25 | 50 | 70 | 100;
  };
  read_at: string | null;
  created_at: string;
};

export type ModerationReport = {
  id: string;
  reporter_address: Address;
  subject_address: Address;
  reason: "spam" | "impersonation" | "manipulation" | "harmful_content" | "other";
  details: string;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
};

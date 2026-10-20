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
  launchpadAddress: Address;
  note: string | null;
  reactionCount: number;
  reacted: boolean;
  followerCount: number;
  isFollowed: boolean;
};

export type PulseMoment = {
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  firstAt: string;
  latestAt: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  distinctWalletCount: number;
  buyQuoteWei: string;
  sellQuoteWei: string;
  netQuoteWei: string;
  followedTraderCount: number;
  reason: "following" | "net_buying" | "net_selling" | "activity";
  sampleTransactionHash: `0x${string}`;
};

/** What a followed wallet did on a market: created it, bought in, or sold out. */
export type FollowingActor = {
  address: Address;
  action: "launch" | "buy" | "sell";
  amountQuoteWei: string;
};

/** A market wallets you follow touched, with who acted and the WETH they moved. */
export type FollowingActivity = {
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  actors: FollowingActor[];
  boughtQuoteWei: string;
  soldQuoteWei: string;
  latestAt: string;
};

export type PulsePeriod = "1h" | "24h";
export type PulseScope = "now" | "following";

export type PulseResponse = {
  items: PulseMoment[];
  asOf: string;
  coveredFrom: string;
  sampleTruncated: boolean;
};

export type LeaderboardMetrics = {
  tradeCount?: number;
  marketCount?: number;
  tradingDayCount?: number;
  recentTradingDayCount?: number;
  recentMarketCount?: number;
  investedWei?: string;
  realizedPnlWei?: string;
  unrealizedPnlWei?: string;
  netPnlWei?: string;
  returnBps?: number | null;
  firstTradeAt?: string | null;
  lastTradeAt?: string | null;
  sampleLabel?: "established" | "provisional";
  methodologyVersion?: string;
  methodologyCaveat?: string;
};

export type LeaderboardTrader = {
  address: Address;
  rank: number;
  stats: TraderStats;
  publishedMetrics: LeaderboardMetrics;
  asOfBlock?: string;
  calculatedAt?: string;
  publishedAt?: string | null;
  methodologyVersion?: string | null;
  period?: string | null;
};

export type LeaderboardSnapshot = {
  category: "consistent" | "new";
  /** Ranked from stored per-trader performance while no current snapshot has qualified traders. */
  provisional?: boolean;
  items: LeaderboardTrader[];
  asOfBlock?: string | null;
  calculatedAt?: string | null;
  publishedAt?: string | null;
  methodologyVersion?: string | null;
  period?: string | null;
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
  claimedAt: string | null;
  stats: TraderStats;
  followers: number;
  following: number;
  isFollowed: boolean;
  isBlocked: boolean;
  positions: TraderPosition[];
};

export type NotificationKind =
  | "followed_buy"
  | "followed_sell"
  | "followed_launch"
  | "new_follower"
  | "curve_milestone"
  | "graduation"
  | "reaction";

export type Notification = {
  id: string;
  kind: NotificationKind;
  actorAddress: Address | null;
  tokenAddress: Address | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  milestone: number | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreferences = {
  inApp: boolean;
  tradeBuys: boolean;
  tradeSells: boolean;
  launches: boolean;
  graduations: boolean;
  newFollowers: boolean;
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

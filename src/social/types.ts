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
  tokenSlug?: string | null;
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
  tokenSlug?: string | null;
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
  tokenSlug?: string | null;
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

export type LeaderboardCategory = "consistent" | "new" | "trending" | "followers";

/** Published v3 ("curve-exit-realized-v3") metrics. Wei amounts are decimal strings. */
export type LeaderboardMetrics = {
  methodologyVersion?: string;
  entityId?: string;
  realizedPnlWei?: string;
  realizedCostWei?: string;
  openValueWei?: string;
  unrealizedPnlWei?: string;
  netPnlWei?: string;
  scoredPnlWei?: string;
  scoreWei?: string;
  peakCapitalWei?: string;
  returnBps?: number | null;
  qualifyingTradeCount?: number;
  tradeCount?: number;
  marketCount?: number;
  activeDayCount?: number;
  staleMarkCount?: number;
  thinMarketCount?: number;
  transferOutCount?: number;
  exitMarkShareBps?: number | null;
  confidence?: LeaderboardConfidence;
  windowDays?: number | null;
  eligibleFollowerCount?: number;
  firstTradeAt?: string | null;
  lastTradeAt?: string | null;
};

export type LeaderboardConfidence = "established" | "developing" | "new";

export type LeaderboardStats = {
  tradeCount: number;
  qualifyingTradeCount: number;
  realizedPnlWei: string;
  realizedCostWei: string;
  realizedReturnPct: number | null;
  marketsTraded: number;
  firstTrade: string | null;
  lastTrade: string | null;
};

export type LeaderboardTrader = {
  address: Address;
  rank: number;
  stats: LeaderboardStats;
  publishedMetrics: LeaderboardMetrics;
  confidence: LeaderboardConfidence;
  followers?: number;
  isFollowed?: boolean;
  asOfBlock?: string;
  publishedAt?: string | null;
  methodologyVersion?: string | null;
};

/** An unranked wallet shown while nobody qualifies. Never carries P&L or percentages. */
export type WatchingTrader = {
  address: Address;
  rank: null;
  provisional: true;
  qualifyingTradeCount: number | null;
  marketCount: number | null;
  activeDayCount: number | null;
  requirementsMet: number | null;
  requirementsTotal: number | null;
  lastTradeAt: string | null;
};

/** Public checklist and scoring numbers; the API generates these from the backend rules. */
export type LeaderboardRules = {
  methodologyVersion?: string;
  minTradeWei?: string;
  shrinkageK?: number;
  openPositionCapBps?: number;
  updateIntervalSec?: number;
  minQualifyingTrades?: number;
  minMarkets?: number;
  minActiveDays?: number;
  minFirstTradeAgeDays?: number;
  maxFirstTradeAgeDays?: number;
  maxLastTradeAgeDays?: number;
  windowDays?: number;
  minPeakCapitalWei?: string;
  maxSingleMarketShareBps?: number;
  minFollowerVolumeWei?: string;
  minFollowerAccountAgeDays?: number;
};

export type LeaderboardProgress = {
  requirementsMet: number;
  requirementsTotal: number;
  walletCount: number;
};

export type LeaderboardStatus = "ranked" | "no_qualifiers" | "pending";

export type LeaderboardSnapshot = {
  category: LeaderboardCategory;
  label?: string;
  status: LeaderboardStatus;
  methodologyVersion?: string | null;
  asOfBlock?: string | null;
  asOfTime?: string | null;
  publishedAt?: string | null;
  stale: boolean;
  paused: boolean;
  ageMinutes: number | null;
  rules: LeaderboardRules;
  items: LeaderboardTrader[];
  watching: WatchingTrader[];
  progress: LeaderboardProgress[];
};

export type TraderPosition = {
  token_address: Address;
  token_name: string;
  token_symbol: string;
  token_slug?: string | null;
  balance_wei: string;
  known_basis_balance_wei: string;
  exact_balance_indexed: boolean;
  invested_wei: string;
  proceeds_wei: string;
  average_entry_market_cap_wei: string | null;
  average_exit_market_cap_wei: string | null;
  virtual_quote_after: string;
  virtual_token_after: string;
  change_24h_bps: string | null;
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
  tokenSlug: string | null;
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
  reason:
    "spam" | "impersonation" | "manipulation" | "harmful_content" | "other";
  details: string;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
};

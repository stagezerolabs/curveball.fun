import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Keep application-owned tables outside Supabase's API-exposed `public` schema.
// The backend connection sets this schema first in its search_path so existing
// hand-tuned SQL and Drizzle queries address the same relations.
export const curveball = pgSchema("curveball");

const chainId = () => bigint("chain_id", { mode: "number" }).notNull();
const uint256 = (name: string) => numeric(name, { precision: 78, scale: 0 }).notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const chains = curveball.table("chains", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  nativeSymbol: text("native_symbol").notNull(),
  finalityConfirmations: integer("finality_confirmations").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
}, (table) => [
  check("chains_finality_check", sql`${table.finalityConfirmations} > 0`),
]);

export const contractDeployments = curveball.table("contract_deployments", {
  chainId: chainId(),
  role: text("role").notNull(),
  address: text("address").notNull(),
  version: text("version").notNull(),
  deploymentBlock: uint256("deployment_block"),
  deploymentTxHash: text("deployment_tx_hash"),
  activeFrom: timestamp("active_from", { withTimezone: true }),
  activeUntil: timestamp("active_until", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.role, table.address] }),
  index("contract_deployments_active_idx").on(table.chainId, table.role, table.activeUntil),
]);

export const protocolAccounts = curveball.table("protocol_accounts", {
  chainId: chainId(),
  address: text("address").notNull(),
  role: text("role").notNull(),
  label: text("label").notNull(),
  isUserAttributable: boolean("is_user_attributable").notNull().default(false),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address, table.role] }),
  index("protocol_accounts_attribution_idx").on(table.chainId, table.isUserAttributable),
]);

export const chainCursors = curveball.table("chain_cursors", {
  chainId: chainId(),
  stream: text("stream").notNull(),
  nextBlock: uint256("next_block"),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.stream] }),
]);

export const chainBlocks = curveball.table("chain_blocks", {
  chainId: chainId(),
  blockNumber: uint256("block_number"),
  blockHash: text("block_hash").notNull(),
  parentHash: text("parent_hash").notNull(),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  canonical: boolean("canonical").notNull().default(true),
  finalized: boolean("finalized").notNull().default(false),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockHash] }),
  uniqueIndex("chain_blocks_canonical_height_uidx").on(table.chainId, table.blockNumber)
    .where(sql`${table.canonical} = true`),
  index("chain_blocks_height_idx").on(table.chainId, table.blockNumber),
]);

export const chainLogs = curveball.table("chain_logs", {
  chainId: chainId(),
  blockHash: text("block_hash").notNull(),
  blockNumber: uint256("block_number"),
  transactionHash: text("transaction_hash").notNull(),
  transactionIndex: integer("transaction_index"),
  logIndex: integer("log_index").notNull(),
  address: text("address").notNull(),
  topic0: text("topic0").notNull(),
  topics: jsonb("topics").notNull().default(sql`'[]'::jsonb`),
  data: text("data").notNull().default("0x"),
  orphaned: boolean("orphaned").notNull().default(false),
  finalized: boolean("finalized").notNull().default(false),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockHash, table.logIndex] }),
  index("chain_logs_block_idx").on(table.chainId, table.blockNumber),
  index("chain_logs_transaction_idx").on(table.chainId, table.transactionHash),
]);

export const assets = curveball.table("assets", {
  chainId: chainId(),
  address: text("address").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull(),
  metadataUri: text("metadata_uri"),
  metadata: jsonb("metadata"),
  metadataFetchedAt: timestamp("metadata_fetched_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address] }),
  check("assets_decimals_check", sql`${table.decimals} between 0 and 255`),
]);

export const markets = curveball.table("markets", {
  chainId: chainId(),
  tokenAddress: text("token_address").notNull(),
  curveAddress: text("curve_address").notNull(),
  creatorAddress: text("creator_address").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  metadataUri: text("metadata_uri").notNull().default(""),
  launchTxHash: text("launch_tx_hash").notNull(),
  launchLogIndex: integer("launch_log_index").notNull(),
  launchBlock: uint256("launch_block"),
  launchedAt: timestamp("launched_at", { withTimezone: true }).notNull(),
  totalSupply: numeric("total_supply", { precision: 78, scale: 0 }),
  curveSupply: numeric("curve_supply", { precision: 78, scale: 0 }),
  reserveAmount: numeric("reserve_amount", { precision: 78, scale: 0 }),
  reserveBps: integer("reserve_bps"),
  initialVirtualQuote: numeric("initial_virtual_quote", { precision: 78, scale: 0 }),
  graduationTargetQuote: numeric("graduation_target_quote", { precision: 78, scale: 0 }),
  feeBps: integer("fee_bps"),
  creatorFeeShareBps: integer("creator_fee_share_bps"),
  buybackFeeShareBps: integer("buyback_fee_share_bps"),
  creatorTaxBps: integer("creator_tax_bps"),
  state: text("state").notNull().default("live"),
  orphaned: boolean("orphaned").notNull().default(false),
  graduated: boolean("graduated").notNull().default(false),
  poolAddress: text("pool_address"),
  graduationBlock: numeric("graduation_block", { precision: 78, scale: 0 }),
  graduatedAt: timestamp("graduated_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.tokenAddress] }),
  uniqueIndex("markets_curve_uidx").on(table.chainId, table.curveAddress),
  index("markets_creator_idx").on(table.chainId, table.creatorAddress, table.launchedAt),
  index("markets_discovery_idx").on(table.chainId, table.orphaned, table.launchedAt),
  check("markets_state_check", sql`${table.state} in ('live','sold_out','ready','deferred','graduated')`),
]);

export const trades = curveball.table("trades", {
  logicalId: text("logical_id").primaryKey(),
  chainId: chainId(),
  blockHash: text("block_hash").notNull(),
  blockNumber: uint256("block_number"),
  transactionHash: text("transaction_hash").notNull(),
  transactionIndex: integer("transaction_index"),
  logIndex: integer("log_index").notNull(),
  tokenAddress: text("token_address").notNull(),
  curveAddress: text("curve_address").notNull(),
  traderAddress: text("trader_address").notNull(),
  isBuy: boolean("is_buy").notNull(),
  grossCurveQuote: uint256("gross_curve_quote"),
  netTraderQuote: uint256("net_trader_quote"),
  feeQuote: uint256("fee_quote"),
  creatorTaxQuote: uint256("creator_tax_quote"),
  tokenAmount: uint256("token_amount"),
  virtualQuoteAfter: uint256("virtual_quote_after"),
  virtualTokenAfter: uint256("virtual_token_after"),
  soldAfter: uint256("sold_after"),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
  finalized: boolean("finalized").notNull().default(false),
}, (table) => [
  uniqueIndex("trades_chain_log_uidx").on(table.chainId, table.transactionHash, table.logIndex),
  index("trades_recent_idx").on(table.chainId, table.blockTimestamp, table.logIndex)
    .where(sql`${table.orphaned} = false`),
  index("trades_trader_idx").on(table.chainId, table.traderAddress, table.blockTimestamp)
    .where(sql`${table.orphaned} = false`),
  index("trades_token_idx").on(table.chainId, table.tokenAddress, table.blockTimestamp)
    .where(sql`${table.orphaned} = false`),
]);

export const venueSwaps = curveball.table("venue_swaps", {
  logicalId: text("logical_id").primaryKey(),
  chainId: chainId(),
  blockHash: text("block_hash").notNull(),
  blockNumber: uint256("block_number"),
  transactionHash: text("transaction_hash").notNull(),
  transactionIndex: integer("transaction_index"),
  logIndex: integer("log_index").notNull(),
  tokenAddress: text("token_address").notNull(),
  quoteAddress: text("quote_address").notNull(),
  poolAddress: text("pool_address").notNull(),
  senderAddress: text("sender_address").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  isBuy: boolean("is_buy").notNull(),
  quoteAmount: uint256("quote_amount"),
  tokenAmount: uint256("token_amount"),
  amount0In: uint256("amount0_in"),
  amount1In: uint256("amount1_in"),
  amount0Out: uint256("amount0_out"),
  amount1Out: uint256("amount1_out"),
  priceX18: uint256("price_x18"),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
  finalized: boolean("finalized").notNull().default(false),
}, (table) => [
  uniqueIndex("venue_swaps_chain_log_uidx").on(table.chainId, table.transactionHash, table.logIndex),
  index("venue_swaps_token_idx").on(table.chainId, table.tokenAddress, table.blockTimestamp),
  index("venue_swaps_pool_idx").on(table.chainId, table.poolAddress, table.blockNumber),
  index("venue_swaps_recipient_idx").on(table.chainId, table.recipientAddress, table.blockTimestamp),
]);

export const assetTransfers = curveball.table("asset_transfers", {
  logicalId: text("logical_id").primaryKey(),
  chainId: chainId(),
  blockHash: text("block_hash").notNull(),
  blockNumber: uint256("block_number"),
  transactionHash: text("transaction_hash").notNull(),
  transactionIndex: integer("transaction_index"),
  logIndex: integer("log_index").notNull(),
  tokenAddress: text("token_address").notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  amount: uint256("amount"),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
  finalized: boolean("finalized").notNull().default(false),
}, (table) => [
  uniqueIndex("asset_transfers_chain_log_uidx").on(table.chainId, table.transactionHash, table.logIndex),
  index("asset_transfers_token_idx").on(table.chainId, table.tokenAddress, table.blockNumber),
  index("asset_transfers_from_idx").on(table.chainId, table.fromAddress, table.blockNumber),
  index("asset_transfers_to_idx").on(table.chainId, table.toAddress, table.blockNumber),
]);

export const protocolFlows = curveball.table("protocol_flows", {
  logicalId: text("logical_id").primaryKey(),
  chainId: chainId(),
  blockHash: text("block_hash").notNull(),
  blockNumber: uint256("block_number"),
  transactionHash: text("transaction_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  category: text("category").notNull(),
  marketTokenAddress: text("market_token_address"),
  assetAddress: text("asset_address"),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  amount: uint256("amount"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
}, (table) => [
  uniqueIndex("protocol_flows_chain_log_uidx").on(table.chainId, table.transactionHash, table.logIndex),
  index("protocol_flows_market_idx").on(table.chainId, table.marketTokenAddress, table.blockNumber),
  index("protocol_flows_category_idx").on(table.chainId, table.category, table.blockNumber),
  check("protocol_flows_category_check", sql`${table.category} in ('launch_fee','fee_accrued','fee_claimed','pool_fee','quote_credited','meme_credited','vested_claim','reserve_registered','reserve_claim','buyback','rescue')`),
]);

export const buybackExecutions = curveball.table("buyback_executions", {
  logicalId: text("logical_id").primaryKey(),
  chainId: chainId(),
  tokenAddress: text("token_address").notNull(),
  venueAddress: text("venue_address").notNull(),
  quoteSpent: uint256("quote_spent"),
  tokensBought: uint256("tokens_bought"),
  transactionHash: text("transaction_hash").notNull(),
  blockNumber: uint256("block_number"),
  blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
}, (table) => [
  index("buyback_executions_token_idx").on(table.chainId, table.tokenAddress, table.blockNumber),
]);

export const reserveRounds = curveball.table("reserve_rounds", {
  chainId: chainId(),
  tokenAddress: text("token_address").notNull(),
  roundId: uint256("round_id"),
  snapshotBlock: uint256("snapshot_block"),
  amount: uint256("amount"),
  eligibleSupply: uint256("eligible_supply"),
  transactionHash: text("transaction_hash").notNull(),
  createdBlock: uint256("created_block"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.tokenAddress, table.roundId] }),
]);

export const reserveClaims = curveball.table("reserve_claims", {
  logicalId: text("logical_id").primaryKey(),
  chainId: chainId(),
  tokenAddress: text("token_address").notNull(),
  roundId: uint256("round_id"),
  holderAddress: text("holder_address").notNull(),
  amount: uint256("amount"),
  transactionHash: text("transaction_hash").notNull(),
  blockNumber: uint256("block_number"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
  orphaned: boolean("orphaned").notNull().default(false),
}, (table) => [
  index("reserve_claims_holder_idx").on(table.chainId, table.holderAddress, table.claimedAt),
  index("reserve_claims_round_idx").on(table.chainId, table.tokenAddress, table.roundId),
]);

export const marketStats = curveball.table("market_stats", {
  chainId: chainId(),
  tokenAddress: text("token_address").notNull(),
  tradeCount: bigint("trade_count", { mode: "number" }).notNull().default(0),
  buyCount: bigint("buy_count", { mode: "number" }).notNull().default(0),
  sellCount: bigint("sell_count", { mode: "number" }).notNull().default(0),
  uniqueTraderCount: bigint("unique_trader_count", { mode: "number" }).notNull().default(0),
  grossQuoteVolume: uint256("gross_quote_volume"),
  walletCashTurnover: uint256("wallet_cash_turnover"),
  tokenVolume: uint256("token_volume"),
  virtualQuote: uint256("virtual_quote"),
  virtualToken: uint256("virtual_token"),
  sold: uint256("sold"),
  currentPriceX18: uint256("current_price_x18"),
  athPriceX18: uint256("ath_price_x18"),
  grossQuoteVolume24h: uint256("gross_quote_volume_24h"),
  change1hBps: numeric("change_1h_bps", { precision: 38, scale: 8 }),
  change6hBps: numeric("change_6h_bps", { precision: 38, scale: 8 }),
  change24hBps: numeric("change_24h_bps", { precision: 38, scale: 8 }),
  latestTradeId: text("latest_trade_id"),
  latestTradeAt: timestamp("latest_trade_at", { withTimezone: true }),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.tokenAddress] }),
  index("market_stats_volume_idx").on(table.chainId, table.grossQuoteVolume),
]);

export const marketCandles = curveball.table("market_candles", {
  chainId: chainId(),
  tokenAddress: text("token_address").notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
  openPriceX18: uint256("open_price_x18"),
  highPriceX18: uint256("high_price_x18"),
  lowPriceX18: uint256("low_price_x18"),
  closePriceX18: uint256("close_price_x18"),
  grossQuoteVolume: uint256("gross_quote_volume"),
  walletCashTurnover: uint256("wallet_cash_turnover"),
  tokenVolume: uint256("token_volume"),
  tradeCount: integer("trade_count").notNull().default(0),
  buyCount: integer("buy_count").notNull().default(0),
  sellCount: integer("sell_count").notNull().default(0),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.tokenAddress, table.intervalSeconds, table.bucketStart] }),
  check("market_candles_interval_check", sql`${table.intervalSeconds} in (60, 300, 900, 3600, 14400, 86400)`),
]);

export const curvePositions = curveball.table("curve_positions", {
  chainId: chainId(),
  traderAddress: text("trader_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  knownBasisTokenBalance: uint256("known_basis_token_balance"),
  totalTokensBought: uint256("total_tokens_bought"),
  totalTokensSold: uint256("total_tokens_sold"),
  unknownBasisTokensSold: uint256("unknown_basis_tokens_sold"),
  totalInvestedQuote: uint256("total_invested_quote"),
  totalProceedsQuote: uint256("total_proceeds_quote"),
  remainingCostBasisQuote: uint256("remaining_cost_basis_quote"),
  realizedCostBasisQuote: uint256("realized_cost_basis_quote"),
  knownBasisProceedsQuote: uint256("known_basis_proceeds_quote"),
  realizedPnlQuote: numeric("realized_pnl_quote", { precision: 78, scale: 0 }).notNull().default("0"),
  tradeCount: integer("trade_count").notNull().default(0),
  firstTradeAt: timestamp("first_trade_at", { withTimezone: true }).notNull(),
  lastTradeAt: timestamp("last_trade_at", { withTimezone: true }).notNull(),
  latestTradeId: text("latest_trade_id").notNull(),
  methodologyVersion: text("methodology_version").notNull().default("curve-weighted-average-v1"),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.traderAddress, table.tokenAddress] }),
  index("curve_positions_wallet_idx").on(table.chainId, table.traderAddress, table.lastTradeAt),
]);

export const assetPriceObservations = curveball.table("asset_price_observations", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: chainId(),
  assetAddress: text("asset_address").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  priceX18: uint256("price_x18"),
  source: text("source").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("asset_price_observations_uidx").on(table.chainId, table.assetAddress, table.quoteCurrency, table.source, table.observedAt),
  index("asset_price_observations_latest_idx").on(table.chainId, table.assetAddress, table.quoteCurrency, table.observedAt),
]);

export const tradeNotes = curveball.table("trade_notes", {
  logicalTradeId: text("logical_trade_id").primaryKey().references(() => trades.logicalId, { onDelete: "cascade" }),
  chainId: chainId(),
  authorAddress: text("author_address").notNull(),
  note: text("note").notNull(),
  updatedAt: updatedAt(),
}, (table) => [
  check("trade_notes_length_check", sql`char_length(${table.note}) between 1 and 240`),
]);

export const tradeReactions = curveball.table("trade_reactions", {
  logicalTradeId: text("logical_trade_id").notNull().references(() => trades.logicalId, { onDelete: "cascade" }),
  chainId: chainId(),
  reactorAddress: text("reactor_address").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.logicalTradeId, table.reactorAddress] }),
  index("trade_reactions_reactor_idx").on(table.chainId, table.reactorAddress, table.createdAt),
]);

export const profiles = curveball.table("profiles", {
  chainId: chainId(),
  address: text("address").notNull(),
  displayName: text("display_name"),
  bio: text("bio").notNull().default(""),
  discoverable: boolean("discoverable").notNull().default(false),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address] }),
  index("profiles_discoverable_idx").on(table.chainId, table.discoverable)
    .where(sql`${table.discoverable} = true`),
  check("profiles_name_length_check", sql`${table.displayName} is null or char_length(${table.displayName}) between 2 and 40`),
  check("profiles_bio_length_check", sql`char_length(${table.bio}) <= 280`),
]);

export const rnsCache = curveball.table("rns_cache", {
  chainId: chainId(),
  address: text("address").notNull(),
  primaryName: text("primary_name"),
  status: text("status").notNull().default("resolved"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address] }),
  index("rns_cache_expiry_idx").on(table.expiresAt),
  check("rns_cache_status_check", sql`${table.status} in ('resolved','not_found','error')`),
]);

export const traderPerformanceSnapshots = curveball.table("trader_performance_snapshots", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: chainId(),
  address: text("address").notNull(),
  period: text("period").notNull(),
  asOfBlock: uint256("as_of_block"),
  realizedPnlQuote: numeric("realized_pnl_quote", { precision: 78, scale: 0 }).notNull(),
  unrealizedPnlQuote: numeric("unrealized_pnl_quote", { precision: 78, scale: 0 }).notNull(),
  investedQuote: uint256("invested_quote"),
  portfolioValueQuote: uint256("portfolio_value_quote"),
  grossQuoteVolume: uint256("gross_quote_volume"),
  walletCashTurnover: uint256("wallet_cash_turnover"),
  returnBps: numeric("return_bps", { precision: 38, scale: 8 }),
  maxDrawdownBps: numeric("max_drawdown_bps", { precision: 38, scale: 8 }),
  concentrationBps: numeric("concentration_bps", { precision: 38, scale: 8 }),
  tradeCount: integer("trade_count").notNull(),
  marketCount: integer("market_count").notNull(),
  profitableMarketCount: integer("profitable_market_count").notNull(),
  methodologyVersion: text("methodology_version").notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trader_performance_snapshot_uidx").on(table.chainId, table.address, table.period, table.asOfBlock, table.methodologyVersion),
  index("trader_performance_wallet_idx").on(table.chainId, table.address, table.calculatedAt),
  check("trader_performance_period_check", sql`${table.period} in ('all','1d','7d','30d','90d')`),
]);

export const leaderboardSnapshots = curveball.table("leaderboard_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: chainId(),
  category: text("category").notNull(),
  period: text("period").notNull(),
  methodologyVersion: text("methodology_version").notNull(),
  asOfBlock: uint256("as_of_block"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("leaderboard_snapshots_uidx").on(table.chainId, table.category, table.period, table.asOfBlock, table.methodologyVersion),
  index("leaderboard_snapshots_published_idx").on(table.chainId, table.category, table.publishedAt),
  check("leaderboard_snapshots_category_check", sql`${table.category} in ('trending','consistent','followers','new')`),
]);

export const leaderboardRows = curveball.table("leaderboard_rows", {
  snapshotId: uuid("snapshot_id").notNull().references(() => leaderboardSnapshots.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  rank: integer("rank").notNull(),
  score: numeric("score", { precision: 38, scale: 18 }).notNull(),
  metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
  eligible: boolean("eligible").notNull().default(true),
  exclusionReason: text("exclusion_reason"),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.address] }),
  uniqueIndex("leaderboard_rows_rank_uidx").on(table.snapshotId, table.rank),
  check("leaderboard_rows_rank_check", sql`${table.rank} > 0`),
]);

export const follows = curveball.table("follows", {
  chainId: chainId(),
  followerAddress: text("follower_address").notNull(),
  followedAddress: text("followed_address").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.followerAddress, table.followedAddress] }),
  index("follows_followed_idx").on(table.chainId, table.followedAddress, table.createdAt),
  check("follows_not_self_check", sql`${table.followerAddress} <> ${table.followedAddress}`),
]);

export const blocks = curveball.table("blocks", {
  chainId: chainId(),
  blockerAddress: text("blocker_address").notNull(),
  blockedAddress: text("blocked_address").notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.blockerAddress, table.blockedAddress] }),
  index("blocks_blocked_idx").on(table.chainId, table.blockedAddress),
  check("blocks_not_self_check", sql`${table.blockerAddress} <> ${table.blockedAddress}`),
]);

export const reports = curveball.table("reports", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: chainId(),
  reporterAddress: text("reporter_address").notNull(),
  subjectAddress: text("subject_address").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index("reports_moderation_idx").on(table.status, table.createdAt),
  check("reports_reason_check", sql`${table.reason} in ('spam','impersonation','manipulation','harmful_content','other')`),
  check("reports_status_check", sql`${table.status} in ('open','reviewing','actioned','dismissed')`),
  check("reports_not_self_check", sql`${table.reporterAddress} <> ${table.subjectAddress}`),
  check("reports_details_length_check", sql`char_length(${table.details}) <= 1000`),
]);

export const notificationPreferences = curveball.table("notification_preferences", {
  chainId: chainId(),
  address: text("address").notNull(),
  inApp: boolean("in_app").notNull().default(true),
  tradeBuys: boolean("trade_buys").notNull().default(true),
  tradeSells: boolean("trade_sells").notNull().default(true),
  graduations: boolean("graduations").notNull().default(true),
  newFollowers: boolean("new_followers").notNull().default(true),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address] }),
]);

export const notifications = curveball.table("notifications", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: chainId(),
  recipientAddress: text("recipient_address").notNull(),
  kind: text("kind").notNull(),
  actorAddress: text("actor_address"),
  logicalEventId: text("logical_event_id"),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("notifications_event_uidx").on(table.chainId, table.recipientAddress, table.kind, table.logicalEventId)
    .where(sql`${table.logicalEventId} is not null`),
  index("notifications_recipient_idx").on(table.chainId, table.recipientAddress, table.createdAt),
  check("notifications_kind_check", sql`${table.kind} in ('followed_buy','followed_sell','new_follower','curve_milestone','graduation','reaction')`),
]);

export const notificationOutbox = curveball.table("notification_outbox", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  eventKey: text("event_key").notNull(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("notification_outbox_event_uidx").on(table.eventKey),
  index("notification_outbox_pending_idx").on(table.availableAt, table.id)
    .where(sql`${table.publishedAt} is null`),
]);

export const copyPreferences = curveball.table("copy_preferences", {
  chainId: chainId(),
  address: text("address").notNull(),
  fixedBuyWei: uint256("fixed_buy_wei").default("10000000000000000"),
  sellPercent: integer("sell_percent").notNull().default(100),
  maxSlippageBps: integer("max_slippage_bps").notNull().default(300),
  dailyBudgetWei: uint256("daily_budget_wei").default("50000000000000000"),
  copySells: boolean("copy_sells").notNull().default(true),
  skipRepeatBuys: boolean("skip_repeat_buys").notNull().default(true),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.address] }),
  check("copy_preferences_sell_percent_check", sql`${table.sellPercent} between 1 and 100`),
  check("copy_preferences_slippage_check", sql`${table.maxSlippageBps} between 1 and 5000`),
]);

export const copyIntents = curveball.table("copy_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: chainId(),
  followerAddress: text("follower_address").notNull(),
  sourceTradeId: text("source_trade_id").notNull().references(() => trades.logicalId),
  idempotencyKey: uuid("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  side: text("side").notNull(),
  inputAmountWei: uint256("input_amount_wei"),
  status: text("status").notNull().default("prepared"),
  skipReason: text("skip_reason"),
  transactionHash: text("transaction_hash"),
  quotedOutputWei: numeric("quoted_output_wei", { precision: 78, scale: 0 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("copy_intents_idempotency_uidx").on(table.chainId, table.followerAddress, table.idempotencyKey),
  index("copy_intents_follower_idx").on(table.chainId, table.followerAddress, table.createdAt),
  index("copy_intents_source_idx").on(table.chainId, table.sourceTradeId, table.createdAt),
  check("copy_intents_side_check", sql`${table.side} in ('buy','sell')`),
  check("copy_intents_status_check", sql`${table.status} in ('prepared','submitted','confirmed','wallet_rejected','reverted','quote_expired','dismissed','skipped')`),
]);

export const copyIntentEvents = curveball.table("copy_intent_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  intentId: uuid("intent_id").notNull().references(() => copyIntents.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actor: text("actor").notNull(),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (table) => [
  index("copy_intent_events_intent_idx").on(table.intentId, table.createdAt),
  check("copy_intent_events_actor_check", sql`${table.actor} in ('user','indexer','worker','system')`),
]);

export const copyExecutions = curveball.table("copy_executions", {
  intentId: uuid("intent_id").primaryKey().references(() => copyIntents.id, { onDelete: "cascade" }),
  submittedTxHash: text("submitted_tx_hash").notNull(),
  confirmedTradeId: text("confirmed_trade_id").references(() => trades.logicalId),
  quoteBlock: numeric("quote_block", { precision: 78, scale: 0 }),
  requestedInputWei: uint256("requested_input_wei"),
  quotedOutputWei: numeric("quoted_output_wei", { precision: 78, scale: 0 }),
  minimumOutputWei: numeric("minimum_output_wei", { precision: 78, scale: 0 }),
  actualInputWei: numeric("actual_input_wei", { precision: 78, scale: 0 }),
  actualOutputWei: numeric("actual_output_wei", { precision: 78, scale: 0 }),
  leaderRateX18: numeric("leader_rate_x18", { precision: 78, scale: 0 }),
  followerRateX18: numeric("follower_rate_x18", { precision: 78, scale: 0 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("copy_executions_tx_uidx").on(table.submittedTxHash),
]);


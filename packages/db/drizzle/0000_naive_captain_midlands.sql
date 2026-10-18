CREATE SCHEMA "curveball";
--> statement-breakpoint
CREATE TABLE "curveball"."asset_price_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"asset_address" text NOT NULL,
	"quote_currency" text NOT NULL,
	"price_x18" numeric(78, 0) NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."assets" (
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	"metadata_uri" text,
	"metadata" jsonb,
	"metadata_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "assets_decimals_check" CHECK ("curveball"."assets"."decimals" between 0 and 255)
);
--> statement-breakpoint
CREATE TABLE "curveball"."auth_nonces" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."blocks" (
	"chain_id" bigint NOT NULL,
	"blocker_address" text NOT NULL,
	"blocked_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_chain_id_blocker_address_blocked_address_pk" PRIMARY KEY("chain_id","blocker_address","blocked_address"),
	CONSTRAINT "blocks_not_self_check" CHECK ("curveball"."blocks"."blocker_address" <> "curveball"."blocks"."blocked_address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."chain_blocks" (
	"chain_id" bigint NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"parent_hash" text NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_blocks_chain_id_block_hash_pk" PRIMARY KEY("chain_id","block_hash")
);
--> statement-breakpoint
CREATE TABLE "curveball"."chain_cursors" (
	"chain_id" bigint NOT NULL,
	"stream" text NOT NULL,
	"next_block" numeric(78, 0) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_cursors_chain_id_stream_pk" PRIMARY KEY("chain_id","stream")
);
--> statement-breakpoint
CREATE TABLE "curveball"."chain_logs" (
	"chain_id" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer,
	"log_index" integer NOT NULL,
	"address" text NOT NULL,
	"topic0" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data" text DEFAULT '0x' NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_logs_chain_id_block_hash_log_index_pk" PRIMARY KEY("chain_id","block_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "curveball"."chains" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"native_symbol" text NOT NULL,
	"finality_confirmations" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_finality_check" CHECK ("curveball"."chains"."finality_confirmations" > 0)
);
--> statement-breakpoint
CREATE TABLE "curveball"."contract_deployments" (
	"chain_id" bigint NOT NULL,
	"role" text NOT NULL,
	"address" text NOT NULL,
	"version" text NOT NULL,
	"deployment_block" numeric(78, 0) NOT NULL,
	"deployment_tx_hash" text,
	"active_from" timestamp with time zone,
	"active_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_deployments_chain_id_role_address_pk" PRIMARY KEY("chain_id","role","address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."copy_executions" (
	"intent_id" uuid PRIMARY KEY NOT NULL,
	"submitted_tx_hash" text NOT NULL,
	"confirmed_trade_id" text,
	"quote_block" numeric(78, 0),
	"requested_input_wei" numeric(78, 0) NOT NULL,
	"quoted_output_wei" numeric(78, 0),
	"minimum_output_wei" numeric(78, 0),
	"actual_input_wei" numeric(78, 0),
	"actual_output_wei" numeric(78, 0),
	"leader_rate_x18" numeric(78, 0),
	"follower_rate_x18" numeric(78, 0),
	"submitted_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"failure_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."copy_intent_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_intent_events_actor_check" CHECK ("curveball"."copy_intent_events"."actor" in ('user','indexer','worker','system'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."copy_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"follower_address" text NOT NULL,
	"source_trade_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"side" text NOT NULL,
	"input_amount_wei" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"skip_reason" text,
	"transaction_hash" text,
	"quoted_output_wei" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_intents_side_check" CHECK ("curveball"."copy_intents"."side" in ('buy','sell')),
	CONSTRAINT "copy_intents_status_check" CHECK ("curveball"."copy_intents"."status" in ('prepared','submitted','confirmed','wallet_rejected','reverted','quote_expired','dismissed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."copy_preferences" (
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"fixed_buy_wei" numeric(78, 0) DEFAULT '10000000000000000' NOT NULL,
	"sell_percent" integer DEFAULT 100 NOT NULL,
	"max_slippage_bps" integer DEFAULT 300 NOT NULL,
	"daily_budget_wei" numeric(78, 0) DEFAULT '50000000000000000' NOT NULL,
	"copy_sells" boolean DEFAULT true NOT NULL,
	"skip_repeat_buys" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_preferences_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "copy_preferences_sell_percent_check" CHECK ("curveball"."copy_preferences"."sell_percent" between 1 and 100),
	CONSTRAINT "copy_preferences_slippage_check" CHECK ("curveball"."copy_preferences"."max_slippage_bps" between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "curveball"."curve_positions" (
	"chain_id" bigint NOT NULL,
	"trader_address" text NOT NULL,
	"token_address" text NOT NULL,
	"known_basis_token_balance" numeric(78, 0) NOT NULL,
	"total_tokens_bought" numeric(78, 0) NOT NULL,
	"total_tokens_sold" numeric(78, 0) NOT NULL,
	"unknown_basis_tokens_sold" numeric(78, 0) NOT NULL,
	"total_invested_quote" numeric(78, 0) NOT NULL,
	"total_proceeds_quote" numeric(78, 0) NOT NULL,
	"remaining_cost_basis_quote" numeric(78, 0) NOT NULL,
	"realized_cost_basis_quote" numeric(78, 0) NOT NULL,
	"known_basis_proceeds_quote" numeric(78, 0) NOT NULL,
	"realized_pnl_quote" numeric(78, 0) DEFAULT '0' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"first_trade_at" timestamp with time zone NOT NULL,
	"last_trade_at" timestamp with time zone NOT NULL,
	"latest_trade_id" text NOT NULL,
	"methodology_version" text DEFAULT 'curve-weighted-average-v1' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curve_positions_chain_id_trader_address_token_address_pk" PRIMARY KEY("chain_id","trader_address","token_address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."follows" (
	"chain_id" bigint NOT NULL,
	"follower_address" text NOT NULL,
	"followed_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_chain_id_follower_address_followed_address_pk" PRIMARY KEY("chain_id","follower_address","followed_address"),
	CONSTRAINT "follows_not_self_check" CHECK ("curveball"."follows"."follower_address" <> "curveball"."follows"."followed_address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."leaderboard_rows" (
	"snapshot_id" uuid NOT NULL,
	"address" text NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(38, 18) NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"exclusion_reason" text,
	CONSTRAINT "leaderboard_rows_snapshot_id_address_pk" PRIMARY KEY("snapshot_id","address"),
	CONSTRAINT "leaderboard_rows_rank_check" CHECK ("curveball"."leaderboard_rows"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "curveball"."leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"category" text NOT NULL,
	"period" text NOT NULL,
	"methodology_version" text NOT NULL,
	"as_of_block" numeric(78, 0) NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "leaderboard_snapshots_category_check" CHECK ("curveball"."leaderboard_snapshots"."category" in ('trending','consistent','followers','new'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."market_candles" (
	"chain_id" bigint NOT NULL,
	"token_address" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"open_price_x18" numeric(78, 0) NOT NULL,
	"high_price_x18" numeric(78, 0) NOT NULL,
	"low_price_x18" numeric(78, 0) NOT NULL,
	"close_price_x18" numeric(78, 0) NOT NULL,
	"gross_quote_volume" numeric(78, 0) NOT NULL,
	"wallet_cash_turnover" numeric(78, 0) NOT NULL,
	"token_volume" numeric(78, 0) NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"buy_count" integer DEFAULT 0 NOT NULL,
	"sell_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_candles_chain_id_token_address_interval_seconds_bucket_start_pk" PRIMARY KEY("chain_id","token_address","interval_seconds","bucket_start"),
	CONSTRAINT "market_candles_interval_check" CHECK ("curveball"."market_candles"."interval_seconds" in (60, 300, 900, 3600, 14400, 86400))
);
--> statement-breakpoint
CREATE TABLE "curveball"."market_stats" (
	"chain_id" bigint NOT NULL,
	"token_address" text NOT NULL,
	"trade_count" bigint DEFAULT 0 NOT NULL,
	"buy_count" bigint DEFAULT 0 NOT NULL,
	"sell_count" bigint DEFAULT 0 NOT NULL,
	"unique_trader_count" bigint DEFAULT 0 NOT NULL,
	"gross_quote_volume" numeric(78, 0) NOT NULL,
	"wallet_cash_turnover" numeric(78, 0) NOT NULL,
	"token_volume" numeric(78, 0) NOT NULL,
	"virtual_quote" numeric(78, 0) NOT NULL,
	"virtual_token" numeric(78, 0) NOT NULL,
	"sold" numeric(78, 0) NOT NULL,
	"latest_trade_id" text,
	"latest_trade_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_stats_chain_id_token_address_pk" PRIMARY KEY("chain_id","token_address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."markets" (
	"chain_id" bigint NOT NULL,
	"token_address" text NOT NULL,
	"curve_address" text NOT NULL,
	"creator_address" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"metadata_uri" text DEFAULT '' NOT NULL,
	"launch_tx_hash" text NOT NULL,
	"launch_log_index" integer NOT NULL,
	"launch_block" numeric(78, 0) NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"total_supply" numeric(78, 0),
	"curve_supply" numeric(78, 0),
	"reserve_amount" numeric(78, 0),
	"reserve_bps" integer,
	"initial_virtual_quote" numeric(78, 0),
	"graduation_target_quote" numeric(78, 0),
	"fee_bps" integer,
	"creator_fee_share_bps" integer,
	"buyback_fee_share_bps" integer,
	"creator_tax_bps" integer,
	"state" text DEFAULT 'live' NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"graduated" boolean DEFAULT false NOT NULL,
	"pool_address" text,
	"graduation_block" numeric(78, 0),
	"graduated_at" timestamp with time zone,
	CONSTRAINT "markets_chain_id_token_address_pk" PRIMARY KEY("chain_id","token_address"),
	CONSTRAINT "markets_state_check" CHECK ("curveball"."markets"."state" in ('live','sold_out','ready','deferred','graduated'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."notification_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."notification_preferences" (
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"trade_buys" boolean DEFAULT true NOT NULL,
	"trade_sells" boolean DEFAULT true NOT NULL,
	"graduations" boolean DEFAULT true NOT NULL,
	"new_followers" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"recipient_address" text NOT NULL,
	"kind" text NOT NULL,
	"actor_address" text,
	"logical_event_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("curveball"."notifications"."kind" in ('followed_buy','followed_sell','new_follower','graduation','reaction'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."profile_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"message_hash" text NOT NULL,
	"signature" text NOT NULL,
	"domain" text NOT NULL,
	"uri" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."profiles" (
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"bio" text DEFAULT '' NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "profiles_name_length_check" CHECK ("curveball"."profiles"."display_name" is null or char_length("curveball"."profiles"."display_name") between 2 and 40),
	CONSTRAINT "profiles_bio_length_check" CHECK (char_length("curveball"."profiles"."bio") <= 280)
);
--> statement-breakpoint
CREATE TABLE "curveball"."protocol_accounts" (
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"role" text NOT NULL,
	"label" text NOT NULL,
	"is_user_attributable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_accounts_chain_id_address_role_pk" PRIMARY KEY("chain_id","address","role")
);
--> statement-breakpoint
CREATE TABLE "curveball"."reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"reporter_address" text NOT NULL,
	"subject_address" text NOT NULL,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reason_check" CHECK ("curveball"."reports"."reason" in ('spam','impersonation','manipulation','harmful_content','other')),
	CONSTRAINT "reports_status_check" CHECK ("curveball"."reports"."status" in ('open','reviewing','actioned','dismissed')),
	CONSTRAINT "reports_not_self_check" CHECK ("curveball"."reports"."reporter_address" <> "curveball"."reports"."subject_address"),
	CONSTRAINT "reports_details_length_check" CHECK (char_length("curveball"."reports"."details") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "curveball"."rns_cache" (
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"primary_name" text,
	"status" text DEFAULT 'resolved' NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rns_cache_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "rns_cache_status_check" CHECK ("curveball"."rns_cache"."status" in ('resolved','not_found','error'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."trade_notes" (
	"logical_trade_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"author_address" text NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_notes_length_check" CHECK (char_length("curveball"."trade_notes"."note") between 1 and 240)
);
--> statement-breakpoint
CREATE TABLE "curveball"."trade_reactions" (
	"logical_trade_id" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"reactor_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_reactions_logical_trade_id_reactor_address_pk" PRIMARY KEY("logical_trade_id","reactor_address")
);
--> statement-breakpoint
CREATE TABLE "curveball"."trader_performance_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" text NOT NULL,
	"period" text NOT NULL,
	"as_of_block" numeric(78, 0) NOT NULL,
	"realized_pnl_quote" numeric(78, 0) NOT NULL,
	"unrealized_pnl_quote" numeric(78, 0) NOT NULL,
	"invested_quote" numeric(78, 0) NOT NULL,
	"portfolio_value_quote" numeric(78, 0) NOT NULL,
	"gross_quote_volume" numeric(78, 0) NOT NULL,
	"wallet_cash_turnover" numeric(78, 0) NOT NULL,
	"return_bps" numeric(38, 8),
	"max_drawdown_bps" numeric(38, 8),
	"concentration_bps" numeric(38, 8),
	"trade_count" integer NOT NULL,
	"market_count" integer NOT NULL,
	"profitable_market_count" integer NOT NULL,
	"methodology_version" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_performance_period_check" CHECK ("curveball"."trader_performance_snapshots"."period" in ('all','1d','7d','30d','90d'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."trades" (
	"logical_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer,
	"log_index" integer NOT NULL,
	"token_address" text NOT NULL,
	"curve_address" text NOT NULL,
	"trader_address" text NOT NULL,
	"is_buy" boolean NOT NULL,
	"gross_curve_quote" numeric(78, 0) NOT NULL,
	"net_trader_quote" numeric(78, 0) NOT NULL,
	"fee_quote" numeric(78, 0) NOT NULL,
	"creator_tax_quote" numeric(78, 0) NOT NULL,
	"token_amount" numeric(78, 0) NOT NULL,
	"virtual_quote_after" numeric(78, 0) NOT NULL,
	"virtual_token_after" numeric(78, 0) NOT NULL,
	"sold_after" numeric(78, 0) NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curveball"."copy_executions" ADD CONSTRAINT "copy_executions_intent_id_copy_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "curveball"."copy_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curveball"."copy_executions" ADD CONSTRAINT "copy_executions_confirmed_trade_id_trades_logical_id_fk" FOREIGN KEY ("confirmed_trade_id") REFERENCES "curveball"."trades"("logical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curveball"."copy_intent_events" ADD CONSTRAINT "copy_intent_events_intent_id_copy_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "curveball"."copy_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curveball"."copy_intents" ADD CONSTRAINT "copy_intents_source_trade_id_trades_logical_id_fk" FOREIGN KEY ("source_trade_id") REFERENCES "curveball"."trades"("logical_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curveball"."leaderboard_rows" ADD CONSTRAINT "leaderboard_rows_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "curveball"."leaderboard_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curveball"."trade_notes" ADD CONSTRAINT "trade_notes_logical_trade_id_trades_logical_id_fk" FOREIGN KEY ("logical_trade_id") REFERENCES "curveball"."trades"("logical_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curveball"."trade_reactions" ADD CONSTRAINT "trade_reactions_logical_trade_id_trades_logical_id_fk" FOREIGN KEY ("logical_trade_id") REFERENCES "curveball"."trades"("logical_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_price_observations_uidx" ON "curveball"."asset_price_observations" USING btree ("chain_id","asset_address","quote_currency","source","observed_at");--> statement-breakpoint
CREATE INDEX "asset_price_observations_latest_idx" ON "curveball"."asset_price_observations" USING btree ("chain_id","asset_address","quote_currency","observed_at");--> statement-breakpoint
CREATE INDEX "auth_nonces_expiry_idx" ON "curveball"."auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "curveball"."blocks" USING btree ("chain_id","blocked_address");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_blocks_canonical_height_uidx" ON "curveball"."chain_blocks" USING btree ("chain_id","block_number") WHERE "curveball"."chain_blocks"."canonical" = true;--> statement-breakpoint
CREATE INDEX "chain_blocks_height_idx" ON "curveball"."chain_blocks" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "chain_logs_block_idx" ON "curveball"."chain_logs" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "chain_logs_transaction_idx" ON "curveball"."chain_logs" USING btree ("chain_id","transaction_hash");--> statement-breakpoint
CREATE INDEX "contract_deployments_active_idx" ON "curveball"."contract_deployments" USING btree ("chain_id","role","active_until");--> statement-breakpoint
CREATE UNIQUE INDEX "copy_executions_tx_uidx" ON "curveball"."copy_executions" USING btree ("submitted_tx_hash");--> statement-breakpoint
CREATE INDEX "copy_intent_events_intent_idx" ON "curveball"."copy_intent_events" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "copy_intents_idempotency_uidx" ON "curveball"."copy_intents" USING btree ("chain_id","follower_address","idempotency_key");--> statement-breakpoint
CREATE INDEX "copy_intents_follower_idx" ON "curveball"."copy_intents" USING btree ("chain_id","follower_address","created_at");--> statement-breakpoint
CREATE INDEX "copy_intents_source_idx" ON "curveball"."copy_intents" USING btree ("chain_id","source_trade_id","created_at");--> statement-breakpoint
CREATE INDEX "curve_positions_wallet_idx" ON "curveball"."curve_positions" USING btree ("chain_id","trader_address","last_trade_at");--> statement-breakpoint
CREATE INDEX "follows_followed_idx" ON "curveball"."follows" USING btree ("chain_id","followed_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_rows_rank_uidx" ON "curveball"."leaderboard_rows" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshots_uidx" ON "curveball"."leaderboard_snapshots" USING btree ("chain_id","category","period","as_of_block","methodology_version");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_published_idx" ON "curveball"."leaderboard_snapshots" USING btree ("chain_id","category","published_at");--> statement-breakpoint
CREATE INDEX "market_stats_volume_idx" ON "curveball"."market_stats" USING btree ("chain_id","gross_quote_volume");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_curve_uidx" ON "curveball"."markets" USING btree ("chain_id","curve_address");--> statement-breakpoint
CREATE INDEX "markets_creator_idx" ON "curveball"."markets" USING btree ("chain_id","creator_address","launched_at");--> statement-breakpoint
CREATE INDEX "markets_discovery_idx" ON "curveball"."markets" USING btree ("chain_id","orphaned","launched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_event_uidx" ON "curveball"."notification_outbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "curveball"."notification_outbox" USING btree ("available_at","id") WHERE "curveball"."notification_outbox"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_uidx" ON "curveball"."notifications" USING btree ("chain_id","recipient_address","kind","logical_event_id") WHERE "curveball"."notifications"."logical_event_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "curveball"."notifications" USING btree ("chain_id","recipient_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_claims_message_uidx" ON "curveball"."profile_claims" USING btree ("chain_id","message_hash");--> statement-breakpoint
CREATE INDEX "profile_claims_wallet_idx" ON "curveball"."profile_claims" USING btree ("chain_id","address","verified_at");--> statement-breakpoint
CREATE INDEX "profiles_discoverable_idx" ON "curveball"."profiles" USING btree ("chain_id","discoverable") WHERE "curveball"."profiles"."discoverable" = true;--> statement-breakpoint
CREATE INDEX "protocol_accounts_attribution_idx" ON "curveball"."protocol_accounts" USING btree ("chain_id","is_user_attributable");--> statement-breakpoint
CREATE INDEX "reports_moderation_idx" ON "curveball"."reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rns_cache_expiry_idx" ON "curveball"."rns_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_wallet_idx" ON "curveball"."sessions" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "curveball"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "trade_reactions_reactor_idx" ON "curveball"."trade_reactions" USING btree ("chain_id","reactor_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_performance_snapshot_uidx" ON "curveball"."trader_performance_snapshots" USING btree ("chain_id","address","period","as_of_block","methodology_version");--> statement-breakpoint
CREATE INDEX "trader_performance_wallet_idx" ON "curveball"."trader_performance_snapshots" USING btree ("chain_id","address","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_chain_log_uidx" ON "curveball"."trades" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "trades_recent_idx" ON "curveball"."trades" USING btree ("chain_id","block_timestamp","log_index") WHERE "curveball"."trades"."orphaned" = false;--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "curveball"."trades" USING btree ("chain_id","trader_address","block_timestamp") WHERE "curveball"."trades"."orphaned" = false;--> statement-breakpoint
CREATE INDEX "trades_token_idx" ON "curveball"."trades" USING btree ("chain_id","token_address","block_timestamp") WHERE "curveball"."trades"."orphaned" = false;
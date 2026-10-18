CREATE TABLE "curveball"."asset_transfers" (
	"logical_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer,
	"log_index" integer NOT NULL,
	"token_address" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."buyback_executions" (
	"logical_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"token_address" text NOT NULL,
	"venue_address" text NOT NULL,
	"quote_spent" numeric(78, 0) NOT NULL,
	"tokens_bought" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."protocol_flows" (
	"logical_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"category" text NOT NULL,
	"market_token_address" text,
	"asset_address" text,
	"from_address" text,
	"to_address" text,
	"amount" numeric(78, 0) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	CONSTRAINT "protocol_flows_category_check" CHECK ("curveball"."protocol_flows"."category" in ('launch_fee','fee_accrued','fee_claimed','pool_fee','quote_credited','meme_credited','vested_claim','reserve_registered','reserve_claim','buyback','rescue'))
);
--> statement-breakpoint
CREATE TABLE "curveball"."reserve_claims" (
	"logical_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"token_address" text NOT NULL,
	"round_id" numeric(78, 0) NOT NULL,
	"holder_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curveball"."reserve_rounds" (
	"chain_id" bigint NOT NULL,
	"token_address" text NOT NULL,
	"round_id" numeric(78, 0) NOT NULL,
	"snapshot_block" numeric(78, 0) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"eligible_supply" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"created_block" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	CONSTRAINT "reserve_rounds_chain_id_token_address_round_id_pk" PRIMARY KEY("chain_id","token_address","round_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_transfers_chain_log_uidx" ON "curveball"."asset_transfers" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "asset_transfers_token_idx" ON "curveball"."asset_transfers" USING btree ("chain_id","token_address","block_number");--> statement-breakpoint
CREATE INDEX "asset_transfers_from_idx" ON "curveball"."asset_transfers" USING btree ("chain_id","from_address","block_number");--> statement-breakpoint
CREATE INDEX "asset_transfers_to_idx" ON "curveball"."asset_transfers" USING btree ("chain_id","to_address","block_number");--> statement-breakpoint
CREATE INDEX "buyback_executions_token_idx" ON "curveball"."buyback_executions" USING btree ("chain_id","token_address","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_flows_chain_log_uidx" ON "curveball"."protocol_flows" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "protocol_flows_market_idx" ON "curveball"."protocol_flows" USING btree ("chain_id","market_token_address","block_number");--> statement-breakpoint
CREATE INDEX "protocol_flows_category_idx" ON "curveball"."protocol_flows" USING btree ("chain_id","category","block_number");--> statement-breakpoint
CREATE INDEX "reserve_claims_holder_idx" ON "curveball"."reserve_claims" USING btree ("chain_id","holder_address","claimed_at");--> statement-breakpoint
CREATE INDEX "reserve_claims_round_idx" ON "curveball"."reserve_claims" USING btree ("chain_id","token_address","round_id");
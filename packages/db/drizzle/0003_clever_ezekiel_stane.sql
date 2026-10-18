CREATE TABLE "curveball"."venue_swaps" (
	"logical_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer,
	"log_index" integer NOT NULL,
	"token_address" text NOT NULL,
	"quote_address" text NOT NULL,
	"pool_address" text NOT NULL,
	"sender_address" text NOT NULL,
	"recipient_address" text NOT NULL,
	"is_buy" boolean NOT NULL,
	"quote_amount" numeric(78, 0) NOT NULL,
	"token_amount" numeric(78, 0) NOT NULL,
	"amount0_in" numeric(78, 0) NOT NULL,
	"amount1_in" numeric(78, 0) NOT NULL,
	"amount0_out" numeric(78, 0) NOT NULL,
	"amount1_out" numeric(78, 0) NOT NULL,
	"price_x18" numeric(78, 0) NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"orphaned" boolean DEFAULT false NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "venue_swaps_chain_log_uidx" ON "curveball"."venue_swaps" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "venue_swaps_token_idx" ON "curveball"."venue_swaps" USING btree ("chain_id","token_address","block_timestamp");--> statement-breakpoint
CREATE INDEX "venue_swaps_pool_idx" ON "curveball"."venue_swaps" USING btree ("chain_id","pool_address","block_number");--> statement-breakpoint
CREATE INDEX "venue_swaps_recipient_idx" ON "curveball"."venue_swaps" USING btree ("chain_id","recipient_address","block_timestamp");
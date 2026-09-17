ALTER TABLE "tokens" ADD COLUMN "quote_liquidity" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "block_number" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "block_time" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trades_token_time_idx" ON "trades" USING btree ("token","block_time");
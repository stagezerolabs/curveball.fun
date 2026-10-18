ALTER TABLE "curveball"."market_stats" ADD COLUMN "current_price_x18" numeric(78, 0) NOT NULL;--> statement-breakpoint
ALTER TABLE "curveball"."market_stats" ADD COLUMN "ath_price_x18" numeric(78, 0) NOT NULL;--> statement-breakpoint
ALTER TABLE "curveball"."market_stats" ADD COLUMN "gross_quote_volume_24h" numeric(78, 0) NOT NULL;--> statement-breakpoint
ALTER TABLE "curveball"."market_stats" ADD COLUMN "change_1h_bps" numeric(38, 8);--> statement-breakpoint
ALTER TABLE "curveball"."market_stats" ADD COLUMN "change_6h_bps" numeric(38, 8);--> statement-breakpoint
ALTER TABLE "curveball"."market_stats" ADD COLUMN "change_24h_bps" numeric(38, 8);
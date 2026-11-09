ALTER TABLE "curveball"."reserve_claims" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "curveball"."reserve_rounds" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "curveball"."reserve_claims" CASCADE;--> statement-breakpoint
DROP TABLE "curveball"."reserve_rounds" CASCADE;--> statement-breakpoint
ALTER TABLE "curveball"."protocol_flows" DROP CONSTRAINT "protocol_flows_category_check";--> statement-breakpoint
ALTER TABLE "curveball"."markets" DROP COLUMN "reserve_amount";--> statement-breakpoint
ALTER TABLE "curveball"."markets" DROP COLUMN "reserve_bps";--> statement-breakpoint
DELETE FROM "curveball"."protocol_flows" WHERE "category" IN ('reserve_registered','reserve_claim');--> statement-breakpoint
ALTER TABLE "curveball"."protocol_flows" ADD CONSTRAINT "protocol_flows_category_check" CHECK ("curveball"."protocol_flows"."category" in ('launch_fee','fee_accrued','fee_claimed','pool_fee','quote_credited','meme_credited','vested_claim','buyback','rescue'));
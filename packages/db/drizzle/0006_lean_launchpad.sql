-- The lean launchpad runs every market's curve itself, so markets and trades point at the launchpad
-- instead of a per-market curve, and the market state follows the launchpad's lifecycle.
-- V1 rows keep their curve address in the renamed column; the indexer orphans them when it first
-- indexes a new launchpad.
ALTER TABLE "curveball"."markets" RENAME COLUMN "curve_address" TO "launchpad_address";--> statement-breakpoint
ALTER TABLE "curveball"."trades" RENAME COLUMN "curve_address" TO "launchpad_address";--> statement-breakpoint
DROP INDEX "curveball"."markets_curve_uidx";--> statement-breakpoint
CREATE INDEX "markets_launchpad_idx" ON "curveball"."markets" USING btree ("chain_id","launchpad_address");--> statement-breakpoint
ALTER TABLE "curveball"."markets" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "curveball"."markets" DROP CONSTRAINT "markets_state_check";--> statement-breakpoint
UPDATE "curveball"."markets" SET "state" = CASE "state"
  WHEN 'live' THEN 'trading'
  WHEN 'sold_out' THEN 'ready'
  WHEN 'deferred' THEN 'ready'
  ELSE "state" END;--> statement-breakpoint
ALTER TABLE "curveball"."markets" ALTER COLUMN "state" SET DEFAULT 'trading';--> statement-breakpoint
ALTER TABLE "curveball"."markets" ADD CONSTRAINT "markets_state_check" CHECK ("curveball"."markets"."state" in ('trading','ready','aborted','graduated'));

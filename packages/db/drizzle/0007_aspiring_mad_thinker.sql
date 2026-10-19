ALTER TABLE "curveball"."reports" ADD COLUMN "subject_trade_id" text;--> statement-breakpoint
CREATE INDEX "reports_trade_moderation_idx" ON "curveball"."reports" USING btree ("chain_id","subject_trade_id","status");--> statement-breakpoint
DELETE FROM "curveball"."follows" f WHERE NOT EXISTS (
  SELECT 1 FROM "curveball"."profiles" p
  WHERE p.chain_id=f.chain_id AND p.address=f.followed_address AND p.discoverable=true
);

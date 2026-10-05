CREATE TABLE "protocol_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"deployment" text NOT NULL,
	"launch" text NOT NULL,
	"kind" text NOT NULL,
	"asset" text,
	"recipient" text,
	"amount" text,
	"tx" text NOT NULL,
	"block_number" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "deployment" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "curve" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "gross_curve_quote" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "fee_quote" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "creator_tax_quote" text;--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_events_event_key_unique" ON "protocol_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "protocol_events_launch_time_idx" ON "protocol_events" USING btree ("launch","block_time");
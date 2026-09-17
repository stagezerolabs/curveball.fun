CREATE TABLE "indexer_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"creator" text NOT NULL,
	"graduated" boolean DEFAULT false NOT NULL,
	"pool" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"token" text NOT NULL,
	"trader" text NOT NULL,
	"side" text NOT NULL,
	"quote" text NOT NULL,
	"amount" text NOT NULL,
	"tx" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "indexer_state_key_unique" ON "indexer_state" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_address_unique" ON "tokens" USING btree ("address");--> statement-breakpoint
CREATE INDEX "tokens_graduated_idx" ON "tokens" USING btree ("graduated") WHERE "tokens"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_event_key_unique" ON "trades" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "trades_token_idx" ON "trades" USING btree ("token") WHERE "trades"."deleted_at" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "curveball_set_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "set_indexer_state_updated_at"
BEFORE UPDATE ON "indexer_state"
FOR EACH ROW EXECUTE FUNCTION "curveball_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_tokens_updated_at"
BEFORE UPDATE ON "tokens"
FOR EACH ROW EXECUTE FUNCTION "curveball_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_trades_updated_at"
BEFORE UPDATE ON "trades"
FOR EACH ROW EXECUTE FUNCTION "curveball_set_updated_at"();

ALTER TABLE "curveball"."leaderboard_snapshots" ADD COLUMN "status" text DEFAULT 'ranked' NOT NULL;--> statement-breakpoint
ALTER TABLE "curveball"."leaderboard_snapshots" ADD COLUMN "as_of_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "curveball"."leaderboard_snapshots" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "curveball"."leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_status_check" CHECK ("curveball"."leaderboard_snapshots"."status" in ('ranked','no_qualifiers'));
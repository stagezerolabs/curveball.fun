ALTER TABLE "curveball"."profiles" DROP CONSTRAINT "profiles_name_length_check";--> statement-breakpoint
ALTER TABLE "curveball"."profiles" DROP CONSTRAINT "profiles_bio_length_check";--> statement-breakpoint
DROP INDEX "curveball"."profiles_discoverable_idx";--> statement-breakpoint
ALTER TABLE "curveball"."profiles" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "curveball"."profiles" DROP COLUMN "bio";--> statement-breakpoint
ALTER TABLE "curveball"."profiles" DROP COLUMN "discoverable";
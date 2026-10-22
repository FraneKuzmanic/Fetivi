ALTER TYPE "public"."guest_notification_kind" ADD VALUE 'daily_tip';--> statement-breakpoint
ALTER TABLE "catalog_records" ADD COLUMN "rainy_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_records" ADD COLUMN "interests" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TYPE "public"."guest_notification_kind" ADD VALUE 'weather_warning';--> statement-breakpoint
ALTER TYPE "public"."guest_notification_kind" ADD VALUE 'ferry_disruption';--> statement-breakpoint
ALTER TABLE "catalog_records" ADD COLUMN "ferry_lines" text[] DEFAULT '{}'::text[] NOT NULL;
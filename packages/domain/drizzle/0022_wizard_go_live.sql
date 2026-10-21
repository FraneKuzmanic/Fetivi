CREATE TYPE "public"."property_type" AS ENUM('apartment', 'studio', 'house', 'villa', 'room', 'guesthouse');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ui_language" "guest_language" DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD COLUMN "wizard_key" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "property_type" "property_type";
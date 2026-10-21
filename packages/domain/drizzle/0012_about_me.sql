CREATE TYPE "public"."about_me_budget" AS ENUM('simple', 'mid', 'treat');--> statement-breakpoint
CREATE TYPE "public"."about_me_interest" AS ENUM('beaches', 'sights', 'food', 'nature', 'day_trips', 'active', 'nightlife', 'shopping', 'slow');--> statement-breakpoint
CREATE TYPE "public"."about_me_need" AS ENUM('gluten_free', 'food_allergy', 'halal', 'kosher', 'step_free', 'limited_mobility');--> statement-breakpoint
CREATE TYPE "public"."about_me_pace" AS ENUM('easy', 'mixed', 'full');--> statement-breakpoint
CREATE TYPE "public"."about_me_party" AS ENUM('solo', 'couple', 'family', 'friends', 'group');--> statement-breakpoint
CREATE TABLE "about_me" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"party" "about_me_party",
	"interests" "about_me_interest"[] DEFAULT '{}' NOT NULL,
	"pace" "about_me_pace",
	"budget" "about_me_budget",
	"needs" "about_me_need"[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "about_me_note" text;--> statement-breakpoint
ALTER TABLE "about_me" ADD CONSTRAINT "about_me_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
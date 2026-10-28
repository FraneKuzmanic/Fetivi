CREATE TYPE "public"."about_me_transport" AS ENUM('car', 'scooter_bike', 'foot_transit');--> statement-breakpoint
ALTER TABLE "about_me" ADD COLUMN "transport" "about_me_transport";--> statement-breakpoint
-- Halal and kosher left the About me needs (ticket 55). The enum keeps both values: dropping enum values in Postgres means recreating the type, not worth it for two unused labels.
UPDATE "about_me" SET "needs" = array_remove(array_remove("needs", 'halal'), 'kosher') WHERE "needs" && ARRAY['halal', 'kosher']::"about_me_need"[];

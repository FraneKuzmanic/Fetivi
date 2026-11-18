ALTER TYPE "public"."guest_language" RENAME TO "language";--> statement-breakpoint
ALTER TYPE "public"."contact_fields" RENAME TO "contact_requirement";--> statement-breakpoint
ALTER TABLE "offers" RENAME COLUMN "contact_fields" TO "contact_requirement";--> statement-breakpoint
ALTER TABLE "plan_items" RENAME COLUMN "place_id" TO "record_id";--> statement-breakpoint
ALTER TABLE "plan_items" RENAME CONSTRAINT "plan_items_place_id_catalog_records_id_fk" TO "plan_items_record_id_catalog_records_id_fk";--> statement-breakpoint
ALTER TABLE "offers" RENAME COLUMN "place_id" TO "record_id";--> statement-breakpoint
ALTER TABLE "offers" RENAME CONSTRAINT "offers_place_id_catalog_records_id_fk" TO "offers_record_id_catalog_records_id_fk";--> statement-breakpoint
ALTER TABLE "host_places" RENAME COLUMN "catalog_record_id" TO "record_id";--> statement-breakpoint
ALTER TABLE "host_places" RENAME CONSTRAINT "host_places_catalog_record_id_catalog_records_id_fk" TO "host_places_record_id_catalog_records_id_fk";--> statement-breakpoint
ALTER TABLE "stays" RENAME COLUMN "checkout" TO "check_out";--> statement-breakpoint
ALTER TABLE "calendar_events" RENAME COLUMN "checkout" TO "check_out";--> statement-breakpoint
ALTER TABLE "properties" RENAME COLUMN "checkout_time" TO "check_out_time";--> statement-breakpoint
ALTER TABLE "units" RENAME COLUMN "checkout_time" TO "check_out_time";--> statement-breakpoint
ALTER TABLE "field_texts" RENAME COLUMN "source" TO "source_text";--> statement-breakpoint
ALTER TABLE "turn_metrics" RENAME COLUMN "mcp_ms" TO "tool_ms";--> statement-breakpoint
ALTER TABLE "catalog_records" ALTER COLUMN "interests" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "catalog_records" ALTER COLUMN "interests" SET DATA TYPE "public"."about_me_interest"[] USING "interests"::"public"."about_me_interest"[];--> statement-breakpoint
ALTER TABLE "catalog_records" ALTER COLUMN "interests" SET DEFAULT '{}'::about_me_interest[];--> statement-breakpoint
ALTER TABLE "plan_items" DROP CONSTRAINT "plan_items_start_time_check";--> statement-breakpoint
ALTER TABLE "plan_items" ALTER COLUMN "start_time" SET DATA TYPE time USING "start_time"::time;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_proposal_id_order_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."order_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_stripe_account_id_unique" UNIQUE("stripe_account_id");--> statement-breakpoint
ALTER TABLE "handoff_messages" DROP COLUMN "reply_translation";--> statement-breakpoint
ALTER TABLE "order_proposals" DROP COLUMN "superseded_at";

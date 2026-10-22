CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" text,
	"title" text NOT NULL,
	"note" text,
	"place_id" uuid,
	"offer_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "plan_items_title_check" CHECK (char_length("plan_items"."title") between 1 and 80),
	CONSTRAINT "plan_items_note_check" CHECK ("plan_items"."note" is null or char_length("plan_items"."note") <= 280),
	CONSTRAINT "plan_items_start_time_check" CHECK ("plan_items"."start_time" is null or "plan_items"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_place_id_catalog_records_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."catalog_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_items_space_date_idx" ON "plan_items" USING btree ("space_id","date");
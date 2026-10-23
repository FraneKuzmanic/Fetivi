ALTER TABLE "curation_items" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "curation_items" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "curation_items" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "curation_items" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "curation_items" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "curation_items" ADD CONSTRAINT "curation_items_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curation_items" ADD CONSTRAINT "curation_items_reviewed_by_accounts_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "curation_items_record_idx" ON "curation_items" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "curation_items" ADD CONSTRAINT "curation_items_dedupe_key_unique" UNIQUE("dedupe_key");
CREATE TYPE "public"."seeding_candidate_status" AS ENUM('new', 'ticked', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."seeding_import_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "seeding_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"status" "seeding_candidate_status" DEFAULT 'new' NOT NULL,
	"ticked_at" timestamp with time zone,
	"ticked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seeding_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"status" "seeding_import_status" DEFAULT 'running' NOT NULL,
	"requested_by" uuid,
	"sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seeding_kept_apart" (
	"candidate_a" uuid NOT NULL,
	"candidate_b" uuid NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seeding_kept_apart_candidate_a_candidate_b_pk" PRIMARY KEY("candidate_a","candidate_b"),
	CONSTRAINT "seeding_kept_apart_order_check" CHECK ("seeding_kept_apart"."candidate_a" < "seeding_kept_apart"."candidate_b")
);
--> statement-breakpoint
-- The new NOT NULL columns have no default; the table holds no production data (ticket 41).
DELETE FROM "place_open_data_sources";--> statement-breakpoint
ALTER TABLE "place_open_data_sources" DROP CONSTRAINT "place_open_data_sources_record_id_catalog_records_id_fk";
--> statement-breakpoint
ALTER TABLE "place_open_data_sources" DROP CONSTRAINT "place_open_data_sources_record_id_source_pk";--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ALTER COLUMN "record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "destination_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "location" geometry(point, 4326) NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "place_category" "place_category" NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "seeding_candidates" ADD CONSTRAINT "seeding_candidates_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeding_candidates" ADD CONSTRAINT "seeding_candidates_ticked_by_accounts_id_fk" FOREIGN KEY ("ticked_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeding_imports" ADD CONSTRAINT "seeding_imports_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeding_imports" ADD CONSTRAINT "seeding_imports_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeding_kept_apart" ADD CONSTRAINT "seeding_kept_apart_candidate_a_seeding_candidates_id_fk" FOREIGN KEY ("candidate_a") REFERENCES "public"."seeding_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeding_kept_apart" ADD CONSTRAINT "seeding_kept_apart_candidate_b_seeding_candidates_id_fk" FOREIGN KEY ("candidate_b") REFERENCES "public"."seeding_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeding_kept_apart" ADD CONSTRAINT "seeding_kept_apart_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seeding_candidates_destination_status_idx" ON "seeding_candidates" USING btree ("destination_id","status");--> statement-breakpoint
CREATE INDEX "seeding_imports_destination_started_idx" ON "seeding_imports" USING btree ("destination_id","started_at");--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD CONSTRAINT "place_open_data_sources_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD CONSTRAINT "place_open_data_sources_candidate_id_seeding_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."seeding_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD CONSTRAINT "place_open_data_sources_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_open_data_sources_candidate_idx" ON "place_open_data_sources" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "place_open_data_sources_record_idx" ON "place_open_data_sources" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "place_open_data_sources_location_gist" ON "place_open_data_sources" USING gist ("location");--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD CONSTRAINT "place_open_data_sources_source_key" UNIQUE("destination_id","source","external_id");--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD CONSTRAINT "place_open_data_sources_link_check" CHECK (not ("place_open_data_sources"."record_id" is not null and "place_open_data_sources"."candidate_id" is not null));
CREATE TYPE "public"."catalog_kind" AS ENUM('place', 'event', 'transport_note', 'day_trip');--> statement-breakpoint
CREATE TYPE "public"."image_source" AS ENUM('own_photo', 'venue_permission', 'wikimedia_commons');--> statement-breakpoint
CREATE TYPE "public"."open_data_source" AS ENUM('osm', 'bathing_water', 'overture', 'foursquare');--> statement-breakpoint
CREATE TYPE "public"."place_category" AS ENUM('beach', 'restaurant', 'cafe_bar', 'sight', 'nature', 'activity', 'shop', 'nightlife');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('ferry', 'catamaran', 'bus', 'boat_taxi', 'taxi', 'train', 'other');--> statement-breakpoint
CREATE TABLE "catalog_opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens" time NOT NULL,
	"closes" time NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "catalog_opening_hours_weekday_check" CHECK ("catalog_opening_hours"."weekday" between 1 and 7),
	CONSTRAINT "catalog_opening_hours_validity_check" CHECK ("catalog_opening_hours"."valid_from" is null or "catalog_opening_hours"."valid_to" is null or "catalog_opening_hours"."valid_from" <= "catalog_opening_hours"."valid_to"),
	CONSTRAINT "catalog_opening_hours_times_check" CHECK ("catalog_opening_hours"."opens" <> "catalog_opening_hours"."closes")
);
--> statement-breakpoint
CREATE TABLE "catalog_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"kind" "catalog_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"place_category" "place_category",
	"location" geometry(point, 4326),
	"address" text,
	"phone" text,
	"website_url" text,
	"venue_name" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"transport_mode" "transport_mode",
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"travel_minutes" smallint,
	"field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer,
	"translation_status" "translation_status" DEFAULT 'pending' NOT NULL,
	"translation_error" "translation_error",
	"source_language" "source_language",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_records_place_check" CHECK ((("catalog_records"."kind" = 'place') = ("catalog_records"."place_category" is not null)) and ("catalog_records"."kind" <> 'place' or "catalog_records"."location" is not null)),
	CONSTRAINT "catalog_records_event_check" CHECK ("catalog_records"."kind" <> 'event' or ("catalog_records"."starts_at" is not null and "catalog_records"."ends_at" is not null and "catalog_records"."ends_at" > "catalog_records"."starts_at")),
	CONSTRAINT "catalog_records_transport_check" CHECK (("catalog_records"."kind" = 'transport_note') = ("catalog_records"."transport_mode" is not null)),
	CONSTRAINT "catalog_records_day_trip_check" CHECK ("catalog_records"."kind" <> 'day_trip' or "catalog_records"."travel_minutes" between 1 and 1440),
	CONSTRAINT "catalog_records_published_revision_check" CHECK ("catalog_records"."published_revision" is null or "catalog_records"."published_revision" <= "catalog_records"."revision")
);
--> statement-breakpoint
CREATE TABLE "catalog_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"from_month" smallint NOT NULL,
	"from_day" smallint NOT NULL,
	"to_month" smallint NOT NULL,
	"to_day" smallint NOT NULL,
	CONSTRAINT "catalog_seasons_range_check" CHECK ("catalog_seasons"."from_month" between 1 and 12 and "catalog_seasons"."to_month" between 1 and 12 and "catalog_seasons"."from_day" between 1 and 31 and "catalog_seasons"."to_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "catalog_translations" (
	"record_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"origin" "translation_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_translations_record_id_revision_language_pk" PRIMARY KEY("record_id","revision","language")
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"centre" geometry(point, 4326) NOT NULL,
	"radius_m" integer NOT NULL,
	"timezone" text DEFAULT 'Europe/Zagreb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destinations_name_unique" UNIQUE("name"),
	CONSTRAINT "destinations_radius_check" CHECK ("destinations"."radius_m" between 1000 and 100000)
);
--> statement-breakpoint
CREATE TABLE "place_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source" "image_source" NOT NULL,
	"licence" text,
	"attribution" text,
	"source_page_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "place_images_wikimedia_check" CHECK ("place_images"."source" <> 'wikimedia_commons' or ("place_images"."licence" is not null and "place_images"."attribution" is not null and "place_images"."source_page_url" is not null)),
	CONSTRAINT "place_images_venue_check" CHECK ("place_images"."source" <> 'venue_permission' or "place_images"."attribution" is not null)
);
--> statement-breakpoint
CREATE TABLE "place_open_data_sources" (
	"record_id" uuid NOT NULL,
	"source" "open_data_source" NOT NULL,
	"external_id" text NOT NULL,
	"licence" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "place_open_data_sources_record_id_source_pk" PRIMARY KEY("record_id","source")
);
--> statement-breakpoint
ALTER TABLE "catalog_opening_hours" ADD CONSTRAINT "catalog_opening_hours_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_verified_by_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_seasons" ADD CONSTRAINT "catalog_seasons_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_translations" ADD CONSTRAINT "catalog_translations_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_images" ADD CONSTRAINT "place_images_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_open_data_sources" ADD CONSTRAINT "place_open_data_sources_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_opening_hours_record_idx" ON "catalog_opening_hours" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "catalog_records_destination_kind_idx" ON "catalog_records" USING btree ("destination_id","kind");--> statement-breakpoint
CREATE INDEX "catalog_records_location_gist" ON "catalog_records" USING gist ("location");--> statement-breakpoint
CREATE INDEX "catalog_seasons_record_idx" ON "catalog_seasons" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "destinations_centre_gist" ON "destinations" USING gist ("centre");--> statement-breakpoint
CREATE INDEX "place_images_record_idx" ON "place_images" USING btree ("record_id");
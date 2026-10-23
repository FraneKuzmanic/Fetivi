CREATE TABLE "host_place_translations" (
	"host_place_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"name" text NOT NULL,
	"note" text NOT NULL,
	"origin" "translation_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_place_translations_host_place_id_revision_language_pk" PRIMARY KEY("host_place_id","revision","language")
);
--> statement-breakpoint
CREATE TABLE "host_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"catalog_record_id" uuid,
	"name" text,
	"place_category" "place_category",
	"location" geometry(point, 4326),
	"address" text,
	"note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer,
	"translation_status" "translation_status" DEFAULT 'pending' NOT NULL,
	"translation_error" "translation_error",
	"source_language" "source_language",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_places_shape_check" CHECK ("host_places"."catalog_record_id" is not null or ("host_places"."name" is not null and "host_places"."place_category" is not null and "host_places"."location" is not null and "host_places"."note" is not null)),
	CONSTRAINT "host_places_published_revision_check" CHECK ("host_places"."published_revision" is null or "host_places"."published_revision" <= "host_places"."revision")
);
--> statement-breakpoint
ALTER TABLE "host_place_translations" ADD CONSTRAINT "host_place_translations_host_place_id_host_places_id_fk" FOREIGN KEY ("host_place_id") REFERENCES "public"."host_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_places" ADD CONSTRAINT "host_places_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_places" ADD CONSTRAINT "host_places_catalog_record_id_catalog_records_id_fk" FOREIGN KEY ("catalog_record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_places_property_idx" ON "host_places" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_places_property_record_uq" ON "host_places" USING btree ("property_id","catalog_record_id");--> statement-breakpoint
CREATE INDEX "host_places_location_gist" ON "host_places" USING gist ("location");
CREATE TYPE "public"."amenity" AS ENUM('ac', 'airport_shuttle', 'balcony', 'beach_access', 'child_friendly', 'crib', 'elevator', 'fireplace', 'free_breakfast', 'gym', 'heating', 'hot_tub', 'ironing_board', 'kitchen', 'microwave', 'outdoor_grill', 'oven_stove', 'patio', 'pets_allowed', 'pool', 'private_beach_access', 'self_check_in', 'smoking_allowed', 'tv', 'washer', 'dryer', 'dishwasher', 'wheelchair_accessible', 'wifi', 'hair_dryer', 'coffee_maker', 'sea_view');--> statement-breakpoint
CREATE TYPE "public"."block_category" AS ENUM('arrival_access', 'wifi_essentials', 'house_rules_checkout', 'how_tos', 'saved_places', 'host_picks', 'contacts_emergency');--> statement-breakpoint
CREATE TYPE "public"."block_visibility" AS ENUM('always', 'after_release');--> statement-breakpoint
CREATE TYPE "public"."check_in_method" AS ENUM('smart_lock', 'keypad', 'lockbox', 'building_staff', 'in_person', 'other');--> statement-breakpoint
CREATE TYPE "public"."parking_type" AS ENUM('none', 'free_on_site', 'paid_on_site', 'free_street', 'paid_street', 'public_garage');--> statement-breakpoint
CREATE TABLE "property_amenities" (
	"property_id" uuid NOT NULL,
	"amenity" "amenity" NOT NULL,
	"note" text,
	CONSTRAINT "property_amenities_property_id_amenity_pk" PRIMARY KEY("property_id","amenity")
);
--> statement-breakpoint
CREATE TABLE "unit_amenities" (
	"unit_id" uuid NOT NULL,
	"amenity" "amenity" NOT NULL,
	"note" text,
	CONSTRAINT "unit_amenities_unit_id_amenity_pk" PRIMARY KEY("unit_id","amenity")
);
--> statement-breakpoint
CREATE TABLE "info_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"unit_id" uuid,
	"category" "block_category" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"visibility" "block_visibility" DEFAULT 'always' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"replaces_block_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_blocks_owner_check" CHECK (num_nonnulls("info_blocks"."property_id", "info_blocks"."unit_id") = 1),
	CONSTRAINT "info_blocks_replaces_check" CHECK ("info_blocks"."replaces_block_id" is null or "info_blocks"."unit_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "unit_hidden_blocks" (
	"unit_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	CONSTRAINT "unit_hidden_blocks_unit_id_block_id_pk" PRIMARY KEY("unit_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line" text,
	"city" text,
	"postal_code" text,
	"country" text DEFAULT 'HR' NOT NULL,
	"location" geometry(point, 4326),
	"timezone" text DEFAULT 'Europe/Zagreb' NOT NULL,
	"building_door_code" text,
	"check_in_time" time,
	"checkout_time" time,
	"check_in_method" "check_in_method",
	"access_instructions" text,
	"parking_type" "parking_type",
	"parking_notes" text,
	"pets_allowed" boolean,
	"smoking_allowed" boolean,
	"parties_allowed" boolean,
	"quiet_hours_from" time,
	"quiet_hours_to" time,
	"house_rules_notes" text,
	"host_phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"licence_number" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qr_slug" text,
	"check_in_time" time,
	"checkout_time" time,
	"check_in_method" "check_in_method",
	"access_instructions" text,
	"parking_type" "parking_type",
	"parking_notes" text,
	"pets_allowed" boolean,
	"smoking_allowed" boolean,
	"parties_allowed" boolean,
	"quiet_hours_from" time,
	"quiet_hours_to" time,
	"house_rules_notes" text,
	"host_phone" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"licence_number" text,
	"no_wifi" boolean DEFAULT false NOT NULL,
	"wifi_network" text,
	"wifi_password" text,
	"door_code" text,
	"lockbox_code" text,
	"max_occupancy" smallint,
	"bedrooms" smallint,
	"beds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bathrooms" smallint,
	"arrival_release_days_before" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_qr_slug_unique" UNIQUE("qr_slug"),
	CONSTRAINT "units_release_days_check" CHECK ("units"."arrival_release_days_before" between 0 and 7),
	CONSTRAINT "units_counts_check" CHECK (("units"."max_occupancy" is null or "units"."max_occupancy" between 1 and 50) and ("units"."bedrooms" is null or "units"."bedrooms" between 0 and 50) and ("units"."bathrooms" is null or "units"."bathrooms" between 0 and 50))
);
--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_amenities" ADD CONSTRAINT "unit_amenities_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD CONSTRAINT "info_blocks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD CONSTRAINT "info_blocks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD CONSTRAINT "info_blocks_replaces_block_id_info_blocks_id_fk" FOREIGN KEY ("replaces_block_id") REFERENCES "public"."info_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hidden_blocks" ADD CONSTRAINT "unit_hidden_blocks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hidden_blocks" ADD CONSTRAINT "unit_hidden_blocks_block_id_info_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."info_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_approved_by_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "info_blocks_property_idx" ON "info_blocks" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "info_blocks_unit_idx" ON "info_blocks" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "properties_host_idx" ON "properties" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "properties_location_gist" ON "properties" USING gist ("location");--> statement-breakpoint
CREATE INDEX "units_property_idx" ON "units" USING btree ("property_id");
CREATE TYPE "public"."adapter_kind" AS ENUM('bokun');--> statement-breakpoint
CREATE TYPE "public"."availability_mode" AS ENUM('live', 'allotment', 'on_request');--> statement-breakpoint
CREATE TYPE "public"."contact_fields" AS ENUM('name', 'phone', 'name_and_phone');--> statement-breakpoint
CREATE TYPE "public"."offer_category" AS ENUM('tour', 'boat_trip', 'dining_experience', 'tasting', 'transfer', 'rental', 'class', 'wellness', 'goods', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('booking', 'ticket', 'purchase', 'request');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('direct', 'online');--> statement-breakpoint
CREATE TYPE "public"."price_unit" AS ENUM('person', 'group', 'item');--> statement-breakpoint
CREATE TABLE "allotment_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"remaining" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allotment_slots_offer_start_unique" UNIQUE("offer_id","starts_at"),
	CONSTRAINT "allotment_slots_capacity_check" CHECK ("allotment_slots"."capacity" between 1 and 999 and "allotment_slots"."remaining" between 0 and "allotment_slots"."capacity")
);
--> statement-breakpoint
CREATE TABLE "offer_translations" (
	"offer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"cancellation_policy" text NOT NULL,
	"origin" "translation_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_translations_offer_id_revision_language_pk" PRIMARY KEY("offer_id","revision","language")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid,
	"host_id" uuid,
	"destination_id" uuid,
	"place_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"cancellation_policy" text NOT NULL,
	"category" "offer_category" NOT NULL,
	"order_kind" "order_kind" NOT NULL,
	"availability_mode" "availability_mode" NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"price_minor" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"price_unit" "price_unit" DEFAULT 'person' NOT NULL,
	"free_cancel_hours_before" integer DEFAULT 24 NOT NULL,
	"refund_percent_after" smallint DEFAULT 0 NOT NULL,
	"response_window_minutes" integer DEFAULT 30 NOT NULL,
	"response_hours_from" time DEFAULT '08:00' NOT NULL,
	"response_hours_to" time DEFAULT '21:00' NOT NULL,
	"contact_fields" "contact_fields" DEFAULT 'name' NOT NULL,
	"adapter_kind" "adapter_kind",
	"external_product_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer,
	"translation_status" "translation_status" DEFAULT 'pending' NOT NULL,
	"translation_error" "translation_error",
	"source_language" "source_language",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_owner_check" CHECK (("offers"."provider_id" is null) <> ("offers"."host_id" is null)),
	CONSTRAINT "offers_destination_check" CHECK ("offers"."provider_id" is null or "offers"."destination_id" is not null),
	CONSTRAINT "offers_price_check" CHECK (("offers"."price_minor" is null and "offers"."order_kind" = 'request') or ("offers"."price_minor" is not null and "offers"."price_minor" between 0 and 10000000)),
	CONSTRAINT "offers_currency_check" CHECK ("offers"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "offers_request_check" CHECK ("offers"."order_kind" <> 'request' or "offers"."availability_mode" = 'on_request'),
	CONSTRAINT "offers_live_check" CHECK ((("offers"."availability_mode" = 'live') = ("offers"."adapter_kind" is not null)) and ("offers"."availability_mode" <> 'live' or "offers"."external_product_ref" is not null)),
	CONSTRAINT "offers_refund_check" CHECK ("offers"."free_cancel_hours_before" between 0 and 720 and "offers"."refund_percent_after" between 0 and 100),
	CONSTRAINT "offers_response_window_check" CHECK ("offers"."response_window_minutes" between 1 and 5759 and "offers"."response_hours_from" < "offers"."response_hours_to"),
	CONSTRAINT "offers_published_revision_check" CHECK ("offers"."published_revision" is null or "offers"."published_revision" <= "offers"."revision")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"whatsapp_phone" text,
	"tax_number" text,
	"commission_bp" integer DEFAULT 0 NOT NULL,
	"deal_notes" text,
	"stripe_account_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_name_unique" UNIQUE("name"),
	CONSTRAINT "providers_commission_check" CHECK ("providers"."commission_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "allotment_slots" ADD CONSTRAINT "allotment_slots_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_translations" ADD CONSTRAINT "offer_translations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_place_id_catalog_records_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."catalog_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offers_provider_idx" ON "offers" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "offers_host_idx" ON "offers" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "offers_destination_idx" ON "offers" USING btree ("destination_id");
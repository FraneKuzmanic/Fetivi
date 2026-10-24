CREATE TYPE "public"."field_text_kind" AS ENUM('access_instructions', 'parking_notes', 'house_rules_notes', 'amenity_note');--> statement-breakpoint
CREATE TABLE "field_text_translations" (
	"field_text_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"text" text NOT NULL,
	"origin" "translation_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_text_translations_field_text_id_revision_language_pk" PRIMARY KEY("field_text_id","revision","language")
);
--> statement-breakpoint
CREATE TABLE "field_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"unit_id" uuid,
	"kind" "field_text_kind" NOT NULL,
	"amenity" "amenity",
	"source" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"translation_status" "translation_status" DEFAULT 'pending' NOT NULL,
	"translation_error" "translation_error",
	"source_language" "source_language",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_texts_owner_uq" UNIQUE NULLS NOT DISTINCT("property_id","unit_id","kind","amenity"),
	CONSTRAINT "field_texts_owner_check" CHECK (num_nonnulls("field_texts"."property_id", "field_texts"."unit_id") = 1),
	CONSTRAINT "field_texts_amenity_check" CHECK (("field_texts"."kind" = 'amenity_note') = ("field_texts"."amenity" is not null))
);
--> statement-breakpoint
ALTER TABLE "field_text_translations" ADD CONSTRAINT "field_text_translations_field_text_id_field_texts_id_fk" FOREIGN KEY ("field_text_id") REFERENCES "public"."field_texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_texts" ADD CONSTRAINT "field_texts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_texts" ADD CONSTRAINT "field_texts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_texts_unit_idx" ON "field_texts" USING btree ("unit_id");
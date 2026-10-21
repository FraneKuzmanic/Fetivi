CREATE TYPE "public"."manual_source" AS ENUM('paste', 'pdf', 'docx', 'txt');--> statement-breakpoint
CREATE TABLE "manual_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"source" "manual_source" NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_imports_unit_id_unique" UNIQUE("unit_id")
);
--> statement-breakpoint
ALTER TABLE "manual_imports" ADD CONSTRAINT "manual_imports_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;
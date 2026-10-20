CREATE TYPE "public"."translation_error" AS ENUM('structure-mismatch', 'model-error', 'not-configured');--> statement-breakpoint
CREATE TYPE "public"."translation_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."guest_language" AS ENUM('en', 'hr', 'de', 'it', 'pl', 'hu', 'fr');--> statement-breakpoint
CREATE TYPE "public"."translation_origin" AS ENUM('source', 'machine', 'host');--> statement-breakpoint
CREATE TABLE "block_translations" (
	"block_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"origin" "translation_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_translations_block_id_revision_language_pk" PRIMARY KEY("block_id","revision","language")
);
--> statement-breakpoint
ALTER TABLE "info_blocks" ADD COLUMN "published_revision" integer;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD COLUMN "translation_status" "translation_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD COLUMN "translation_error" "translation_error";--> statement-breakpoint
ALTER TABLE "info_blocks" ADD COLUMN "source_language" text;--> statement-breakpoint
ALTER TABLE "block_translations" ADD CONSTRAINT "block_translations_block_id_info_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."info_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_blocks" ADD CONSTRAINT "info_blocks_published_revision_check" CHECK ("info_blocks"."published_revision" is null or "info_blocks"."published_revision" <= "info_blocks"."revision");
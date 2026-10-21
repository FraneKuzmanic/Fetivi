CREATE TYPE "public"."media_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TABLE "block_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"caption" text NOT NULL,
	"added_revision" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_media_content_type_check" CHECK ("block_media"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'))
);
--> statement-breakpoint
ALTER TABLE "block_translations" ADD COLUMN "captions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "block_media" ADD CONSTRAINT "block_media_block_id_info_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."info_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_media_block_idx" ON "block_media" USING btree ("block_id");
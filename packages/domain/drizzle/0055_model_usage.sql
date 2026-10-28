CREATE TYPE "public"."model_use" AS ENUM('translation', 'handoff_translation', 'drafting', 'manual_import');--> statement-breakpoint
CREATE TABLE "model_usage" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "model_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone NOT NULL,
	"use" "model_use" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "model_usage_at_idx" ON "model_usage" USING btree ("at");
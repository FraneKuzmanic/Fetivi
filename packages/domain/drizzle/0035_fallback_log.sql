CREATE TYPE "public"."fallback_outcome" AS ENUM('results', 'no_results', 'rejected', 'unavailable');--> statement-breakpoint
CREATE TABLE "fallback_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fallback_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"destination_id" uuid,
	"property_id" uuid,
	"topic" text,
	"place" text,
	"outcome" "fallback_outcome" NOT NULL,
	"result_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fallback_log" ADD CONSTRAINT "fallback_log_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fallback_log" ADD CONSTRAINT "fallback_log_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fallback_log_destination_created_idx" ON "fallback_log" USING btree ("destination_id","created_at");
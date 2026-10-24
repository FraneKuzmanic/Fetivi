CREATE TYPE "public"."gap_topic" AS ENUM('address', 'check_in_time', 'check_in_method', 'access_instructions', 'arrival_directions', 'wifi', 'amenities', 'parking', 'occupancy', 'rooms_beds', 'supplies', 'checkout_time', 'house_rules', 'quiet_hours', 'house_rules_notes', 'checkout_steps', 'shared_spaces', 'rubbish_recycling', 'heating_cooling', 'kitchen_appliances', 'laundry', 'pool_outdoor', 'hot_water', 'host_phone', 'emergency_contact', 'medical_help');--> statement-breakpoint
CREATE TABLE "content_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stay_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"topic" "gap_topic" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "content_gaps_stay_id_topic_unique" UNIQUE("stay_id","topic")
);
--> statement-breakpoint
CREATE TABLE "host_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"topic" "gap_topic" NOT NULL,
	"stay_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "content_gaps" ADD CONSTRAINT "content_gaps_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_gaps" ADD CONSTRAINT "content_gaps_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_suggestions" ADD CONSTRAINT "host_suggestions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_gaps_unit_topic_idx" ON "content_gaps" USING btree ("unit_id","topic","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_suggestions_open_idx" ON "host_suggestions" USING btree ("unit_id","topic") WHERE resolved_at is null;
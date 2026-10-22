CREATE TYPE "public"."calendar_event_status" AS ENUM('pending', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."calendar_source" AS ENUM('airbnb', 'booking');--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"uid" text NOT NULL,
	"check_in" date NOT NULL,
	"checkout" date NOT NULL,
	"summary" text,
	"status" "calendar_event_status" DEFAULT 'pending' NOT NULL,
	"stay_id" uuid,
	"vanished_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_feed_uid_unique" UNIQUE("feed_id","uid"),
	CONSTRAINT "calendar_events_dates_check" CHECK ("calendar_events"."checkout" > "calendar_events"."check_in"),
	CONSTRAINT "calendar_events_dismissed_check" CHECK (("calendar_events"."status" = 'dismissed') = ("calendar_events"."dismissed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"source" "calendar_source" NOT NULL,
	"url" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_unit_url_unique" UNIQUE("unit_id","url")
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "booking_links_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_feed_id_calendar_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."calendar_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_stay_idx" ON "calendar_events" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "calendar_feeds_unit_idx" ON "calendar_feeds" USING btree ("unit_id");
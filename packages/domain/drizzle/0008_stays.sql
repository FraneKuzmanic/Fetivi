CREATE TABLE "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"check_in" date NOT NULL,
	"checkout" date NOT NULL,
	"party_size" smallint NOT NULL,
	"booker_name" text,
	"reservation_number" text,
	"pin" text NOT NULL,
	"arrival_release_at" timestamp with time zone NOT NULL,
	"active_until" timestamp with time zone NOT NULL,
	"possibly_cancelled" boolean DEFAULT false NOT NULL,
	"pin_sent_at" timestamp with time zone,
	"handover_language" "guest_language" DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stays_pin_check" CHECK ("stays"."pin" ~ '^[0-9]{6}$'),
	CONSTRAINT "stays_dates_check" CHECK ("stays"."checkout" > "stays"."check_in"),
	CONSTRAINT "stays_party_check" CHECK ("stays"."party_size" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stays_unit_active_idx" ON "stays" USING btree ("unit_id","active_until");
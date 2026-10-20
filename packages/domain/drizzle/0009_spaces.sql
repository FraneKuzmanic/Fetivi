CREATE TABLE "pin_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pin_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"property_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stay_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"language" "guest_language" NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spaces_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pin_attempts_property_idx" ON "pin_attempts" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "pin_attempts_device_idx" ON "pin_attempts" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "pin_attempts_ip_idx" ON "pin_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "spaces_stay_idx" ON "spaces" USING btree ("stay_id");
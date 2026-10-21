CREATE TYPE "public"."pending_action_kind" AS ENUM('create_order');--> statement-breakpoint
CREATE TYPE "public"."pending_state" AS ENUM('pending', 'consumed', 'released');--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "pending_action_kind" NOT NULL,
	"space_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"state" "pending_state" DEFAULT 'pending' NOT NULL,
	"order_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "pending_actions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_actions_space_idx" ON "pending_actions" USING btree ("space_id");
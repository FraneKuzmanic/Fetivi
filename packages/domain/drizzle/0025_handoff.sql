CREATE TYPE "public"."handoff_reason" AS ENUM('property_question', 'problem', 'request', 'guest_asked');--> statement-breakpoint
CREATE TYPE "public"."handoff_translation_state" AS ENUM('pending', 'done', 'not_needed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."handoff_urgency" AS ENUM('normal', 'urgent');--> statement-breakpoint
ALTER TYPE "public"."pending_action_kind" ADD VALUE 'send_host_message';--> statement-breakpoint
CREATE TABLE "handoff_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"reason" "handoff_reason" NOT NULL,
	"urgency" "handoff_urgency" NOT NULL,
	"guest_language" "guest_language" NOT NULL,
	"text" text NOT NULL,
	"host_language" "guest_language" NOT NULL,
	"translation" text,
	"translation_state" "handoff_translation_state" NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"reply_text" text,
	"replied_at" timestamp with time zone,
	"replied_by" uuid,
	"reply_language" "guest_language",
	"reply_translation" text,
	"reply_translation_state" "handoff_translation_state",
	"reply_delivered_at" timestamp with time zone,
	CONSTRAINT "handoff_messages_space_id_unique" UNIQUE("space_id")
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "inbox_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD CONSTRAINT "handoff_messages_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD CONSTRAINT "handoff_messages_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD CONSTRAINT "handoff_messages_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD CONSTRAINT "handoff_messages_replied_by_accounts_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoff_messages_unit_sent_idx" ON "handoff_messages" USING btree ("unit_id","sent_at");--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_order_id_kind" CHECK (("pending_actions"."kind" = 'create_order') = ("pending_actions"."order_id" is not null));
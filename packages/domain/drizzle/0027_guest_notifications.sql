CREATE TYPE "public"."guest_channel" AS ENUM('inbox', 'email', 'push');--> statement-breakpoint
CREATE TYPE "public"."guest_notification_kind" AS ENUM('order_confirmed', 'order_new_proposal', 'order_cancelled', 'order_declined', 'order_expired', 'order_failed', 'order_reminder', 'host_reply', 'arrival_details', 'checkout_reminder');--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_suppressions_reason_check" CHECK ("email_suppressions"."reason" in ('bounced', 'complained'))
);
--> statement-breakpoint
CREATE TABLE "guest_notification_deliveries" (
	"key" text NOT NULL,
	"channel" "guest_channel" NOT NULL,
	"kind" "guest_notification_kind" NOT NULL,
	"space_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_notification_deliveries_key_channel_pk" PRIMARY KEY("key","channel")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "push_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_notification_deliveries" ADD CONSTRAINT "guest_notification_deliveries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_notification_deliveries_space_idx" ON "guest_notification_deliveries" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_space_idx" ON "push_subscriptions" USING btree ("space_id");
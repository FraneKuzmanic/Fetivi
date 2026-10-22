CREATE TYPE "public"."host_channel" AS ENUM('email', 'push');--> statement-breakpoint
CREATE TYPE "public"."host_delivery_mode" AS ENUM('immediate', 'digest');--> statement-breakpoint
CREATE TABLE "host_notification_deliveries" (
	"key" text NOT NULL,
	"channel" "host_channel" NOT NULL,
	"host_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "host_notification_deliveries_key_channel_pk" PRIMARY KEY("key","channel")
);
--> statement-breakpoint
CREATE TABLE "host_notification_settings" (
	"host_id" uuid PRIMARY KEY NOT NULL,
	"mode" "host_delivery_mode" NOT NULL,
	"digest_times" text[] NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "host_push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD COLUMN "host_notification_key" text;--> statement-breakpoint
ALTER TABLE "handoff_messages" ADD COLUMN "host_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_notification_deliveries" ADD CONSTRAINT "host_notification_deliveries_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_notification_settings" ADD CONSTRAINT "host_notification_settings_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_push_subscriptions" ADD CONSTRAINT "host_push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_notification_deliveries_host_idx" ON "host_notification_deliveries" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "host_push_subscriptions_account_idx" ON "host_push_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "handoff_messages_pending_host_idx" ON "handoff_messages" USING btree ("unit_id","sent_at") WHERE host_notification_key is null and read_at is null;
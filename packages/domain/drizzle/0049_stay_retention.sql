CREATE TABLE "kept_conversations" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"language" "guest_language" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"messages" jsonb NOT NULL,
	"kept_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_ledger" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"offer_title" text NOT NULL,
	"provider_id" uuid,
	"provider_name" text,
	"host_id" uuid,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"quantity" smallint NOT NULL,
	"price_minor" integer,
	"currency" text NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"commission_bp" integer NOT NULL,
	"status" "order_status" NOT NULL,
	"payment_status" "payment_status" NOT NULL,
	"guest_email" text NOT NULL,
	"order_created_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"keep_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_message_cap" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_settings_single_row" CHECK ("platform_settings"."id" = 1),
	CONSTRAINT "platform_settings_cap_check" CHECK ("platform_settings"."daily_message_cap" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "turn_metrics" DROP CONSTRAINT "turn_metrics_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "evaluation_opt_in_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "order_ledger_keep_until_idx" ON "order_ledger" USING btree ("keep_until");
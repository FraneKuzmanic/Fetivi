-- payment_attempts was always empty: pay-online Orders were refused before 0036.
CREATE TYPE "public"."provider_card_status" AS ENUM('active', 'pending', 'restricted', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('requires_capture', 'succeeded', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('open', 'complete', 'expired');--> statement-breakpoint
ALTER TYPE "public"."guest_notification_kind" ADD VALUE 'order_checkout_expired' BEFORE 'order_reminder';--> statement-breakpoint
ALTER TYPE "public"."order_notification" ADD VALUE 'order_checkout_expired';--> statement-breakpoint
ALTER TYPE "public"."order_notification" ADD VALUE 'admin_payment_attention';--> statement-breakpoint
ALTER TYPE "public"."order_trigger" ADD VALUE 'payment_job';--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stripe_card_payments" "provider_card_status";--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "stripe_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "proposal_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "stripe_account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "amount_minor" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "currency" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "application_fee_minor" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "product_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "locale" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "expires_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "create_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "session_status" "session_status";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "intent_status" "intent_status";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refund_id" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "refund_status" "refund_status";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "processed_event_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_session_id_unique" UNIQUE("session_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_intent_id_unique" UNIQUE("payment_intent_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_proposal_unique" UNIQUE("proposal_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_check" CHECK ("payment_attempts"."amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_fee_check" CHECK ("payment_attempts"."application_fee_minor" >= 0 and "payment_attempts"."application_fee_minor" <= "payment_attempts"."amount_minor");
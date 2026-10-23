-- Reconciliation runs and findings (34); nothing here uses the new order_trigger value.
CREATE TYPE "public"."reconciliation_finding_kind" AS ENUM('session_completed', 'session_expired', 'intent_canceled', 'intent_captured', 'refund_succeeded', 'refund_failed', 'hold_expired', 'hold_on_confirmed', 'orphan_session', 'check_failed');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_finding_status" AS ENUM('resolved', 'needs_attention', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."reconcile_trigger" AS ENUM('schedule', 'admin');--> statement-breakpoint
ALTER TYPE "public"."order_trigger" ADD VALUE 'reconciliation';--> statement-breakpoint
CREATE TABLE "reconciliation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "reconciliation_finding_kind" NOT NULL,
	"subject" text NOT NULL,
	"order_id" uuid,
	"attempt_id" uuid,
	"hold_id" uuid,
	"stripe_ref" text,
	"detail" text NOT NULL,
	"action" text,
	"status" "reconciliation_finding_status" NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "reconcile_trigger" NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"checked" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_resolved_by_accounts_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_findings_open_unique" ON "reconciliation_findings" USING btree ("kind","subject") WHERE status = 'needs_attention';--> statement-breakpoint
CREATE INDEX "reconciliation_findings_status_idx" ON "reconciliation_findings" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_idx" ON "reconciliation_runs" USING btree ("started_at");
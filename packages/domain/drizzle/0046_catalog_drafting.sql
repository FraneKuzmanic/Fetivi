CREATE TYPE "public"."drafting_failure" AS ENUM('fetch-failed', 'model-error', 'not-configured', 'record-gone');--> statement-breakpoint
CREATE TYPE "public"."drafting_run_kind" AS ENUM('draft', 'refresh');--> statement-breakpoint
CREATE TYPE "public"."drafting_task_status" AS ENUM('queued', 'drafted', 'diffed', 'unchanged', 'no_sources', 'failed');--> statement-breakpoint
CREATE TABLE "drafting_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"kind" "drafting_run_kind" NOT NULL,
	"cap" smallint NOT NULL,
	"waiting" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafting_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"curation_item_id" uuid,
	"record_id" uuid,
	"status" "drafting_task_status" DEFAULT 'queued' NOT NULL,
	"failure" "drafting_failure",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "drafting_tasks_subject_check" CHECK (("drafting_tasks"."curation_item_id" is null) <> ("drafting_tasks"."record_id" is null))
);
--> statement-breakpoint
ALTER TABLE "drafting_runs" ADD CONSTRAINT "drafting_runs_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafting_runs" ADD CONSTRAINT "drafting_runs_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafting_tasks" ADD CONSTRAINT "drafting_tasks_run_id_drafting_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."drafting_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafting_tasks" ADD CONSTRAINT "drafting_tasks_curation_item_id_curation_items_id_fk" FOREIGN KEY ("curation_item_id") REFERENCES "public"."curation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafting_tasks" ADD CONSTRAINT "drafting_tasks_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafting_runs_destination_kind_started_idx" ON "drafting_runs" USING btree ("destination_id","kind","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drafting_tasks_queued_item_key" ON "drafting_tasks" USING btree ("curation_item_id") WHERE status = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "drafting_tasks_queued_record_key" ON "drafting_tasks" USING btree ("record_id") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "drafting_tasks_run_status_idx" ON "drafting_tasks" USING btree ("run_id","status");
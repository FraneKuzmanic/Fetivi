-- Host's own services (38): hidden Providers, the host's own Stripe account and the curation queue table.
CREATE TYPE "public"."curation_kind" AS ENUM('draft', 'refresh_diff', 'guest_flagged', 'host_place_suggestion', 'host_provider_suggestion', 'fallback_topic_cluster');--> statement-breakpoint
CREATE TYPE "public"."curation_status" AS ENUM('open', 'approved', 'rejected', 'needs_visit');--> statement-breakpoint
CREATE TABLE "curation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "curation_kind" NOT NULL,
	"status" "curation_status" DEFAULT 'open' NOT NULL,
	"destination_id" uuid,
	"host_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_hidden_providers" (
	"host_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_hidden_providers_host_id_provider_id_pk" PRIMARY KEY("host_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "stripe_card_payments" "provider_card_status";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "stripe_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "curation_items" ADD CONSTRAINT "curation_items_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curation_items" ADD CONSTRAINT "curation_items_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_hidden_providers" ADD CONSTRAINT "host_hidden_providers_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_hidden_providers" ADD CONSTRAINT "host_hidden_providers_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "curation_items_status_kind_created_idx" ON "curation_items" USING btree ("status","kind","created_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_stripe_account_id_unique" UNIQUE("stripe_account_id");
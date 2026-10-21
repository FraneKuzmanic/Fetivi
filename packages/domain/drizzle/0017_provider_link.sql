CREATE TYPE "public"."order_notification" AS ENUM('provider_request', 'order_confirmed', 'order_declined', 'order_expired', 'order_failed', 'order_cancelled', 'order_new_proposal', 'admin_window_missed', 'provider_confirmed', 'admin_provider_cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider_language" AS ENUM('hr', 'en');--> statement-breakpoint
CREATE TABLE "order_notification_deliveries" (
	"order_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"kind" "order_notification" NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_notification_deliveries_order_id_proposal_id_kind_pk" PRIMARY KEY("order_id","proposal_id","kind")
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "language" "provider_language" DEFAULT 'hr' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_proposals" ADD COLUMN "provider_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_notification_deliveries" ADD CONSTRAINT "order_notification_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notification_deliveries" ADD CONSTRAINT "order_notification_deliveries_proposal_id_order_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."order_proposals"("id") ON DELETE cascade ON UPDATE no action;
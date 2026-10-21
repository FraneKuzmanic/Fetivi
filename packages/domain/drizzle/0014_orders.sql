CREATE TYPE "public"."hold_state" AS ENUM('held', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_confirmation', 'confirming', 'pending_provider', 'confirmed', 'declined', 'expired', 'failed', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."order_trigger" AS ENUM('guest', 'adapter', 'provider_link', 'card_timer', 'hold_timer', 'window_timer', 'completion_timer', 'admin', 'payment_webhook');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('none', 'authorized', 'captured', 'voided', 'refund_pending', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proposer" AS ENUM('offer', 'provider_time', 'provider_price', 'admin');--> statement-breakpoint
CREATE TABLE "inventory_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"slot_id" uuid,
	"external_ref" text,
	"quantity" smallint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" "hold_state" DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "inventory_holds_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" uuid NOT NULL,
	"proposal_id" uuid,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"from_payment_status" "payment_status",
	"to_payment_status" "payment_status" NOT NULL,
	"trigger" "order_trigger" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"slot_id" uuid,
	"quantity" smallint NOT NULL,
	"price_minor" integer,
	"currency" text NOT NULL,
	"proposer" "proposer" NOT NULL,
	"card_expires_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_proposals_order_version_unique" UNIQUE("order_id","version"),
	CONSTRAINT "order_proposals_quantity_check" CHECK ("order_proposals"."quantity" between 1 and 999)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"availability_mode" "availability_mode" NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_confirmation' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'none' NOT NULL,
	"date" date NOT NULL,
	"quantity" smallint NOT NULL,
	"guest_email" text NOT NULL,
	"guest_name" text,
	"guest_phone" text,
	"provider_external_ref" text,
	"provider_link_token_hash" text,
	"cancellation_policy" text NOT NULL,
	"free_cancel_hours_before" integer NOT NULL,
	"refund_percent_after" smallint NOT NULL,
	"currency" text NOT NULL,
	"price_unit" "price_unit" NOT NULL,
	"commission_bp" integer NOT NULL,
	"current_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_provider_link_token_hash_unique" UNIQUE("provider_link_token_hash"),
	CONSTRAINT "orders_quantity_check" CHECK ("orders"."quantity" between 1 and 999),
	CONSTRAINT "orders_payment_check" CHECK ("orders"."payment_mode" = 'online' or "orders"."payment_status" = 'none')
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_proposal_id_order_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."order_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_slot_id_allotment_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."allotment_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_proposals" ADD CONSTRAINT "order_proposals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_proposals" ADD CONSTRAINT "order_proposals_slot_id_allotment_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."allotment_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_current_proposal_id_order_proposals_id_fk" FOREIGN KEY ("current_proposal_id") REFERENCES "public"."order_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_proposal_id_order_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."order_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "orders_space_idx" ON "orders" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "orders_stay_idx" ON "orders" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "orders_offer_idx" ON "orders" USING btree ("offer_id");
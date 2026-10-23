-- One admin payment alert per flagging OrderEvent (33 review): the column comes before the key.
ALTER TABLE "order_notification_deliveries" DROP CONSTRAINT "order_notification_deliveries_order_id_proposal_id_kind_pk";--> statement-breakpoint
ALTER TABLE "order_notification_deliveries" ADD COLUMN "event_id" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_notification_deliveries" ADD CONSTRAINT "order_notification_deliveries_order_id_proposal_id_kind_event_id_pk" PRIMARY KEY("order_id","proposal_id","kind","event_id");

ALTER TABLE "orders" ADD COLUMN "guest_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "guest_note_translation" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "guest_note_translated_to" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_note_check" CHECK ("orders"."guest_note" is null or char_length("orders"."guest_note") between 1 and 500);
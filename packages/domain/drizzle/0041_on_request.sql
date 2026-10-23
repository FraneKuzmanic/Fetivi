-- On-request Offers (36): the respond pending kind and the stored response deadline.
ALTER TYPE "public"."pending_action_kind" ADD VALUE 'respond_to_order_update';--> statement-breakpoint
ALTER TABLE "order_proposals" ADD COLUMN "response_due_at" timestamp with time zone;
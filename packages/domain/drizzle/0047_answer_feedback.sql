CREATE TYPE "public"."answer_topic" AS ENUM('arrival', 'wifi', 'checkout', 'contacts', 'places', 'beach', 'restaurant', 'cafe_bar', 'sight', 'nature', 'activity', 'shop', 'nightlife', 'day_trip', 'host_picks', 'events', 'weather', 'transport', 'web_search', 'services', 'orders', 'host_message', 'plan', 'about_me', 'general');--> statement-breakpoint
CREATE TYPE "public"."feedback_reason" AS ENUM('wrong', 'outdated', 'not_helpful');--> statement-breakpoint
CREATE TYPE "public"."feedback_thumb" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE "answer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"conversation_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"topics" "answer_topic"[] NOT NULL,
	"thumb" "feedback_thumb",
	"reason" "feedback_reason",
	"flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "answer_feedback_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "answer_feedback_reason_check" CHECK ("answer_feedback"."reason" is null or "answer_feedback"."thumb" = 'down')
);
--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_feedback_stay_idx" ON "answer_feedback" USING btree ("stay_id");
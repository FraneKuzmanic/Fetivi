CREATE TYPE "public"."space_token_purpose" AS ENUM('verify_email', 'recover');--> statement-breakpoint
CREATE TABLE "space_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"purpose" "space_token_purpose" NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "tips_email_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_tokens" ADD CONSTRAINT "space_tokens_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_tokens_space_purpose_idx" ON "space_tokens" USING btree ("space_id","purpose","created_at");--> statement-breakpoint
UPDATE "spaces" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL;

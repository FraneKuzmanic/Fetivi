ALTER TABLE "accounts" ADD COLUMN "ui_language_chosen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "accounts" SET "ui_language_chosen_at" = "updated_at" WHERE "ui_language" <> 'en';

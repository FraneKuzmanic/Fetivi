ALTER TABLE "platform_settings" ADD COLUMN "llm_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "llm_key_last4" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "llm_key_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "llm_key_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_llm_key_updated_by_accounts_id_fk" FOREIGN KEY ("llm_key_updated_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_llm_key_check" CHECK (("platform_settings"."llm_key_ciphertext" is null) = ("platform_settings"."llm_key_last4" is null));
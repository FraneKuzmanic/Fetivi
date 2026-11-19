ALTER TABLE "platform_settings" ADD COLUMN "llm_provider" text;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "llm_model" text;--> statement-breakpoint
-- A key saved before 71 is always an Anthropic key.
UPDATE "platform_settings" SET "llm_provider" = 'anthropic' WHERE "llm_key_ciphertext" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_llm_provider_check" CHECK (("platform_settings"."llm_key_ciphertext" is null) = ("platform_settings"."llm_provider" is null));
-- Emails given before verification existed (ticket 25 Order cards) already got updates; keep them
-- getting updates instead of silently stopping, since no confirmation link was ever sent to them.
UPDATE "spaces" SET "email_verified_at" = "email_opt_in_at" WHERE "email" IS NOT NULL AND "email_opt_in_at" IS NOT NULL AND "email_verified_at" IS NULL;

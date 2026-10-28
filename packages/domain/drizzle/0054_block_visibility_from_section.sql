-- Ticket 52: hosts no longer choose visibility; the Guide section decides it (ADR 0025). Rewrites
-- every block by the rule in blockVisibilityOf: arrival and access waits for the arrival release.
UPDATE "info_blocks" SET "visibility" = CASE WHEN "category" = 'arrival_access' THEN 'after_release'::"block_visibility" ELSE 'always'::"block_visibility" END;

-- Chat rows stored input_tokens as the AI SDK total (uncached + cache read + cache write) until ticket 59; keep only the uncached part, the meaning of Anthropic's input_tokens.
UPDATE "turn_metrics" SET "input_tokens" = "input_tokens" - "cache_read_tokens" - "cache_write_tokens";

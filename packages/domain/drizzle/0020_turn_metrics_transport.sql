CREATE TYPE "public"."tool_transport" AS ENUM('mcp', 'inprocess');--> statement-breakpoint
ALTER TABLE "turn_metrics" ADD COLUMN "transport" "tool_transport" DEFAULT 'mcp' NOT NULL;
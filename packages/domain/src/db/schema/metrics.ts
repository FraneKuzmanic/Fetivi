import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { TOOL_TRANSPORTS } from '../../metrics/vocabulary';

export const toolTransport = pgEnum('tool_transport', TOOL_TRANSPORTS);

/** One row per completed guest turn, for the thesis tables. Counts and names only, never text. */
export const turnMetrics = pgTable(
  'turn_metrics',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /**
     * Opaque, no FK: the counts survive the 30-day deletion of the conversation (PRD §6.5
     * "otherwise aggregate counts"), like answer_feedback.
     */
    conversationId: uuid('conversation_id').notNull(),
    model: text('model').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    wallMs: integer('wall_ms').notNull(),
    /**
     * Time inside the tool transport: MCP connect, tools/list, resources/read and tools/call, or
     * the in-process tool calls and projection read.
     */
    mcpMs: integer('mcp_ms').notNull(),
    /** Which tool transport ran the turn: MCP (V1) or in-process domain calls (V0). */
    transport: toolTransport('transport').notNull().default('mcp'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    steps: integer('steps').notNull(),
    toolCalls: integer('tool_calls').notNull(),
    /** One entry per call, in call order, with repeats. */
    toolNames: text('tool_names').array().notNull(),
  },
  (t) => [index('turn_metrics_conversation_idx').on(t.conversationId)],
);

export type TurnMetricsRow = typeof turnMetrics.$inferSelect;

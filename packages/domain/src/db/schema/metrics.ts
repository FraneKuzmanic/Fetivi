import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations';

/** One row per completed guest turn, for the thesis tables. Counts and names only, never text. */
export const turnMetrics = pgTable(
  'turn_metrics',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    wallMs: integer('wall_ms').notNull(),
    /** Time inside MCP connect, tools/list, resources/read and tools/call. */
    mcpMs: integer('mcp_ms').notNull(),
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

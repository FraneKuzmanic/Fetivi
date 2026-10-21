import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { GuestProjection } from '../../projection/projection';
import { spaces } from './spaces';

export const messageRole = pgEnum('message_role', ['system', 'user', 'assistant']);
/** 'inbox' is reserved for notifications in the Conversation (one table for chat and badge). */
export const messageKind = pgEnum('message_kind', ['chat', 'inbox']);

/**
 * An AI SDK v7 UIMessage part (text, tool call with its result, and later component, elicitation
 * and inbox parts). The chat backend owns the exact shape; the domain stays free of `ai`.
 */
export type MessagePart = { type: string } & Record<string, unknown>;

/** One ongoing conversation per Space. */
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  spaceId: uuid('space_id')
    .notNull()
    .unique()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  /** The top-level system text, byte-exact; never changes for the conversation's life. */
  systemPrompt: text('system_prompt').notNull(),
  /** The Guest projection the model has last been given (frozen text plus later change notes). */
  projection: jsonb('projection').$type<GuestProjection>().notNull(),
  /** The text of the last situation note appended, or null before the first. */
  situationNote: text('situation_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export type ConversationRow = typeof conversations.$inferSelect;

export const messages = pgTable(
  'messages',
  {
    /** The AI SDK message id (a server-made UUID string). */
    id: text('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Order within the conversation, from 1. */
    seq: integer('seq').notNull(),
    role: messageRole('role').notNull(),
    kind: messageKind('kind').notNull().default('chat'),
    /** Typed parts: text, tool call with its result, and later component, elicitation and inbox parts. */
    parts: jsonb('parts').$type<MessagePart[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('messages_conversation_seq_idx').on(t.conversationId, t.seq)],
);

export type MessageRow = typeof messages.$inferSelect;

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
/**
 * 'inbox' holds what reaches the guest outside the chat turns: host replies (ticket 23), later
 * notifications. One table for chat and badge.
 */
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
  /** The text of the last About me note appended, or null if none was ever needed. */
  aboutMeNote: text('about_me_note'),
  /** The text of the last weather note appended, or null before the first. */
  weatherNote: text('weather_note'),
  /** When the guest last saw the Chat with its inbox messages; the badge counts inbox messages after it. */
  inboxSeenAt: timestamp('inbox_seen_at', { withTimezone: true }),
  /**
   * The seq up to which host replies (inbox rows) are covered by the model's notes. A reply stored
   * while a turn runs is above it, so the next turn still notes it (ADR 0006).
   */
  hostReplyNotedSeq: integer('host_reply_noted_seq').notNull().default(0),
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

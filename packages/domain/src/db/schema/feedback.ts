import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ANSWER_TOPICS, FEEDBACK_REASONS, THUMBS } from '../../feedback/vocabulary';
import { messages } from './conversations';
import { stays } from './stays';

export const feedbackThumb = pgEnum('feedback_thumb', THUMBS);
export const feedbackReason = pgEnum('feedback_reason', FEEDBACK_REASONS);
export const answerTopic = pgEnum('answer_topic', ANSWER_TOPICS);

/**
 * Feedback (architecture §4.2): one row per assistant chat answer, with what it was about and
 * the guest's thumb and one-tap reason. Counts and topics only: there is no text column, and
 * the row outlives the conversation (no cascade from messages or conversations) so the stats
 * survive the 30-day deletion (PRD §6.5).
 */
export const answerFeedback = pgTable(
  'answer_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The answer while it exists; null after the conversation is deleted. */
    messageId: text('message_id')
      .unique()
      .references(() => messages.id, { onDelete: 'set null' }),
    /** Opaque, no FK: counts conversations per Stay after the conversation is gone. */
    conversationId: uuid('conversation_id').notNull(),
    stayId: uuid('stay_id')
      .notNull()
      .references(() => stays.id, { onDelete: 'cascade' }),
    topics: answerTopic('topics').array().notNull(),
    thumb: feedbackThumb('thumb'),
    /** Only with a thumbs down. */
    reason: feedbackReason('reason'),
    /** When the answer's places were flagged for curation; at most once per answer. */
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('answer_feedback_stay_idx').on(t.stayId),
    check('answer_feedback_reason_check', sql`${t.reason} is null or ${t.thumb} = 'down'`),
  ],
);

export type AnswerFeedbackRow = typeof answerFeedback.$inferSelect;

import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  HANDOFF_REASONS,
  HANDOFF_TRANSLATION_STATES,
  HANDOFF_URGENCIES,
} from '../../handoff/vocabulary';
import { accounts } from './accounts';
import { units } from './properties';
import { spaces } from './spaces';
import { stays } from './stays';
import { guestLanguage } from './translations';

export const handoffReason = pgEnum('handoff_reason', HANDOFF_REASONS);
export const handoffUrgency = pgEnum('handoff_urgency', HANDOFF_URGENCIES);
export const handoffTranslationState = pgEnum(
  'handoff_translation_state',
  HANDOFF_TRANSLATION_STATES,
);

/**
 * A Host message: what a guest sent their host after tapping Send, and the host's one reply.
 * Only explicitly sent messages live here; drafts stay in `pending_actions`.
 */
export const handoffMessages = pgTable(
  'handoff_messages',
  {
    /** Minted in the first half and stored in the pending payload, so a replayed tap finds it. */
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unique: one Host message per Conversation (one Conversation per Space), server-side. */
    spaceId: uuid('space_id')
      .notNull()
      .unique()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    stayId: uuid('stay_id')
      .notNull()
      .references(() => stays.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    reason: handoffReason('reason').notNull(),
    urgency: handoffUrgency('urgency').notNull(),
    /** The space's language at send. */
    guestLanguage: guestLanguage('guest_language').notNull(),
    /** What the guest sent, after their edits. */
    text: text('text').notNull(),
    /** The host account's back-office language at send. */
    hostLanguage: guestLanguage('host_language').notNull(),
    /** Null until done, and when not needed. */
    translation: text('translation'),
    translationState: handoffTranslationState('translation_state').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    /** Set only by the host's own session opening the message. */
    readAt: timestamp('read_at', { withTimezone: true }),
    replyText: text('reply_text'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    repliedBy: uuid('replied_by').references(() => accounts.id, { onDelete: 'set null' }),
    /** The space's language at reply time. */
    replyLanguage: guestLanguage('reply_language'),
    replyTranslation: text('reply_translation'),
    replyTranslationState: handoffTranslationState('reply_translation_state'),
    /** When the reply reached the Conversation as an inbox message. */
    replyDeliveredAt: timestamp('reply_delivered_at', { withTimezone: true }),
    /**
     * Which notification told the host: `handoff:<id>:host` (immediate) or
     * `host:<hostId>:digest:<slot>`. Set once; a message is notified by one path only.
     */
    hostNotificationKey: text('host_notification_key'),
    hostNotifiedAt: timestamp('host_notified_at', { withTimezone: true }),
  },
  (t) => [
    index('handoff_messages_unit_sent_idx').on(t.unitId, t.sentAt),
    index('handoff_messages_pending_host_idx')
      .on(t.unitId, t.sentAt)
      .where(sql`host_notification_key is null and read_at is null`),
  ],
);

export type HandoffMessageRow = typeof handoffMessages.$inferSelect;

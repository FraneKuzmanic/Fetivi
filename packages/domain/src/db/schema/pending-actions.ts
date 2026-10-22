import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { PENDING_ACTION_KINDS, PENDING_STATES } from '../../services/pending/vocabulary';
import { spaces } from './spaces';
import { stays } from './stays';

export const pendingActionKind = pgEnum('pending_action_kind', PENDING_ACTION_KINDS);
export const pendingState = pgEnum('pending_state', PENDING_STATES);

/**
 * A write a guest has not confirmed yet: the first half of an elicitation tool stores it, the
 * guest's tap consumes it exactly once. The model's re-sent arguments never reach it.
 */
export const pendingActions = pgTable(
  'pending_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: pendingActionKind('kind').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    stayId: uuid('stay_id')
      .notNull()
      .references(() => stays.id, { onDelete: 'cascade' }),
    state: pendingState('state').notNull().default('pending'),
    /** The order handle a create_order confirmation creates; minted in the first half, so no FK. */
    orderId: uuid('order_id').unique(),
    /** The stored draft, checked against its kind's schema when read. */
    payload: jsonb('payload').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('pending_actions_space_idx').on(t.spaceId),
    check(
      'pending_actions_order_id_kind',
      sql`(${t.kind} = 'create_order') = (${t.orderId} is not null)`,
    ),
  ],
);

export type PendingActionRow = typeof pendingActions.$inferSelect;

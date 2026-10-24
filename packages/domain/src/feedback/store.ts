import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { enqueueCurationItem } from '../curation/store';
import { REVIEWABLE_STATUSES } from '../curation/vocabulary';
import type { Db, Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { conversations, type MessagePart, messages } from '../db/schema/conversations';
import { curationItems } from '../db/schema/curation';
import { answerFeedback } from '../db/schema/feedback';
import { spaces } from '../db/schema/spaces';
import { answerPlaceIds, answerTopics } from './topics';
import {
  type FeedbackReason,
  type FlaggingReason,
  isFlaggingReason,
  type Thumb,
} from './vocabulary';

export class FeedbackRuleError extends Error {
  override name = 'FeedbackRuleError';
  constructor(readonly code: 'not-found' | 'invalid-input') {
    super(code);
  }
}

export interface AnswerRating {
  thumb: Thumb | null;
  reason: FeedbackReason | null;
}

/** Inserts the answer's row, or recomputes its topics (a resumed turn continues the message). */
async function upsertAnswer(
  tx: Executor,
  row: { messageId: string; conversationId: string; stayId: string; parts: MessagePart[] },
  now: Date,
): Promise<void> {
  const topics = answerTopics(row.parts);
  await tx
    .insert(answerFeedback)
    .values({
      messageId: row.messageId,
      conversationId: row.conversationId,
      stayId: row.stayId,
      topics,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: answerFeedback.messageId, set: { topics, updatedAt: now } });
}

/**
 * Records one feedback row per assistant chat answer, inside the turn's transaction (43 AC 1,
 * AC 3). Only the derived topic codes are stored, never the answer's text.
 */
export async function recordAnswers(
  tx: Executor,
  conversationId: string,
  answers: { id: string; parts: MessagePart[] }[],
  now: Date,
): Promise<void> {
  if (!answers.length) return;
  const [conv] = await tx
    .select({ stayId: spaces.stayId })
    .from(conversations)
    .innerJoin(spaces, eq(spaces.id, conversations.spaceId))
    .where(eq(conversations.id, conversationId));
  if (!conv) throw new FeedbackRuleError('not-found');
  for (const a of answers) {
    await upsertAnswer(
      tx,
      { messageId: a.id, conversationId, stayId: conv.stayId, parts: a.parts },
      now,
    );
  }
}

/**
 * Bumps the open guest-flagged item of each catalog record, or enqueues one (39 AC 5). No
 * dedupe key: it would stay on reviewed items and block later flags of the same record.
 */
async function flagAnswerPlaces(
  tx: Executor,
  ids: string[],
  reason: FlaggingReason,
  now: Date,
): Promise<void> {
  if (!ids.length) return;
  // Drops ids that are not (or no longer) catalog records.
  const records = await tx
    .select({ id: catalogRecords.id, destinationId: catalogRecords.destinationId })
    .from(catalogRecords)
    .where(inArray(catalogRecords.id, ids));
  for (const record of records) {
    const [open] = await tx
      .select({ id: curationItems.id })
      .from(curationItems)
      .where(
        and(
          eq(curationItems.kind, 'guest_flagged'),
          eq(curationItems.recordId, record.id),
          inArray(curationItems.status, [...REVIEWABLE_STATUSES]),
          sql`${curationItems.payload}->>'reason' = ${reason}`,
        ),
      )
      .orderBy(asc(curationItems.createdAt))
      .limit(1)
      .for('update');
    if (open) {
      await tx
        .update(curationItems)
        .set({
          payload: sql`jsonb_set(${curationItems.payload}, '{count}', to_jsonb((${curationItems.payload}->>'count')::int + 1))`,
          updatedAt: now,
        })
        .where(eq(curationItems.id, open.id));
    } else {
      await enqueueCurationItem(
        tx,
        {
          recordId: record.id,
          destinationId: record.destinationId,
          payload: { kind: 'guest_flagged', reason, count: 1 },
        },
        now,
      );
    }
  }
}

/**
 * The guest's thumb and one-tap reason on one of their own Fetivi answers (43 AC 1). A reason
 * goes only with a thumbs down. Outdated or wrong flags the answer's catalog places for curation,
 * once per answer (43 AC 2). Another space's message reads as missing.
 */
export async function setAnswerFeedback(
  db: Db,
  input: {
    spaceId: string;
    messageId: string;
    thumb: Thumb | null;
    reason: FeedbackReason | null;
    now: Date;
  },
): Promise<AnswerRating> {
  const { thumb, reason, now } = input;
  if (reason !== null && thumb !== 'down') throw new FeedbackRuleError('invalid-input');
  return db.transaction(async (tx) => {
    const [message] = await tx
      .select({
        parts: messages.parts,
        conversationId: messages.conversationId,
        stayId: spaces.stayId,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(spaces, eq(spaces.id, conversations.spaceId))
      .where(
        and(
          eq(messages.id, input.messageId),
          eq(conversations.spaceId, input.spaceId),
          eq(messages.role, 'assistant'),
          eq(messages.kind, 'chat'),
        ),
      );
    if (!message) throw new FeedbackRuleError('not-found');
    // Answers stored before ticket 43 get their row now.
    await upsertAnswer(tx, { messageId: input.messageId, ...message }, now);
    const [row] = await tx
      .select({ id: answerFeedback.id, flaggedAt: answerFeedback.flaggedAt })
      .from(answerFeedback)
      .where(eq(answerFeedback.messageId, input.messageId))
      .for('update');
    if (!row) throw new FeedbackRuleError('not-found');
    const flag = isFlaggingReason(reason) && row.flaggedAt === null;
    if (flag) await flagAnswerPlaces(tx, answerPlaceIds(message.parts), reason, now);
    await tx
      .update(answerFeedback)
      .set({
        thumb,
        reason,
        updatedAt: now,
        // Set even when there were no places, so a later change of reason never flags.
        ...(flag ? { flaggedAt: now } : {}),
      })
      .where(eq(answerFeedback.id, row.id));
    return { thumb, reason };
  });
}

/** The conversation's rated answers, keyed by message id, for the chat history. */
export async function listConversationFeedback(
  db: Executor,
  conversationId: string,
): Promise<Record<string, { thumb: Thumb; reason: FeedbackReason | null }>> {
  const rows = await db
    .select({
      messageId: answerFeedback.messageId,
      thumb: answerFeedback.thumb,
      reason: answerFeedback.reason,
    })
    .from(answerFeedback)
    .where(and(eq(answerFeedback.conversationId, conversationId), isNotNull(answerFeedback.thumb)));
  const out: Record<string, { thumb: Thumb; reason: FeedbackReason | null }> = {};
  for (const r of rows) {
    if (r.messageId !== null && r.thumb !== null)
      out[r.messageId] = { thumb: r.thumb, reason: r.reason };
  }
  return out;
}

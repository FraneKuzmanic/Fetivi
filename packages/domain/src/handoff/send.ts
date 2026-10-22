import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Executor, pgCode } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { type HandoffMessageRow, handoffMessages } from '../db/schema/handoff';
import { pendingActions } from '../db/schema/pending-actions';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import { enqueueHostNotification } from '../notifications/host/enqueue';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { insertPending, lockPending, markPending } from '../services/pending/store';
import { PENDING_TTL_SECONDS, type PendingState } from '../services/pending/vocabulary';
import {
  HANDOFF_LIMITS,
  HANDOFF_REASONS,
  HANDOFF_URGENCIES,
  type HandoffReason,
  type HandoffUrgency,
} from './vocabulary';

// The `send_host_message` halves of the approved-action binding (architecture §4.3). The first
// half stores the draft as a pending record; nothing about the message leaves the database
// before the guest's tap (Egress). The second half reads the stored draft and the guest's own
// text only: model-sent arguments never reach it.

/** The stored `send_host_message` draft. */
export const hostMessagePayload = z.object({
  messageId: z.uuid(),
  text: z.string().min(1).max(HANDOFF_LIMITS.messageChars),
  reason: z.enum(HANDOFF_REASONS),
  urgency: z.enum(HANDOFF_URGENCIES),
  language: z.enum(GUEST_LANGUAGES),
});
export type HostMessageDraft = z.infer<typeof hostMessagePayload>;

export type HandoffRuleCode =
  | 'already-sent'
  | 'already-replied'
  | 'invalid-input'
  | 'expired'
  | 'released'
  | 'not-found';

export class HandoffRuleError extends Error {
  override name = 'HandoffRuleError';
  constructor(readonly code: HandoffRuleCode) {
    super(code);
  }
}

/** What the guest's card shows once sent. */
export interface SentHostMessage {
  id: string;
  text: string;
  urgency: HandoffUrgency;
  sentAt: string;
}

const UNIQUE_SPACE = 'handoff_messages_space_id_unique';

/** Trimmed text within `max`, else `invalid-input`. */
export function cleanText(text: string, max: number): string {
  const clean = text.trim();
  if (!clean || clean.length > max) throw new HandoffRuleError('invalid-input');
  return clean;
}

/** One Host message per Conversation: refuses once the space has sent one. */
export async function assertCanHandOff(db: Executor, spaceId: string): Promise<void> {
  const [sent] = await db
    .select({ id: handoffMessages.id })
    .from(handoffMessages)
    .where(eq(handoffMessages.spaceId, spaceId));
  if (sent) throw new HandoffRuleError('already-sent');
}

/**
 * The first half: checks the never-twice rule and stores a pending record bound to the space,
 * valid for PENDING_TTL_SECONDS. No other side effect.
 */
export async function prepareHostMessage(
  deps: { db: Executor; now: () => Date },
  ctx: { spaceId: string; language: GuestLanguage },
  input: { text: string; reason: HandoffReason; urgency: HandoffUrgency },
): Promise<{ pendingId: string; draft: HostMessageDraft }> {
  await assertCanHandOff(deps.db, ctx.spaceId);
  const text = cleanText(input.text, HANDOFF_LIMITS.messageChars);
  const [space] = await deps.db
    .select({ stayId: spaces.stayId })
    .from(spaces)
    .where(eq(spaces.id, ctx.spaceId));
  if (!space) throw new HandoffRuleError('not-found');
  const draft: HostMessageDraft = {
    messageId: randomUUID(),
    text,
    reason: input.reason,
    urgency: input.urgency,
    language: ctx.language,
  };
  const now = deps.now();
  const row = await insertPending(deps.db, {
    kind: 'send_host_message',
    spaceId: ctx.spaceId,
    stayId: space.stayId,
    payload: draft,
    expiresAt: new Date(now.getTime() + PENDING_TTL_SECONDS * 1000),
    now,
  });
  return { pendingId: row.id, draft };
}

/** A pending `send_host_message` record of this space with its draft; null when it is not one. */
export async function getPendingHostMessage(
  db: Executor,
  pendingId: string,
  spaceId: string,
): Promise<{ state: PendingState; expiresAt: Date; draft: HostMessageDraft } | null> {
  const [row] = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.spaceId, spaceId)));
  if (row?.kind !== 'send_host_message') return null;
  return {
    state: row.state,
    expiresAt: row.expiresAt,
    draft: hostMessagePayload.parse(row.payload),
  };
}

export const sentMessage = (row: HandoffMessageRow): SentHostMessage => ({
  id: row.id,
  text: row.text,
  urgency: row.urgency,
  sentAt: row.sentAt.toISOString(),
});

type Completion =
  | { ok: true; message: SentHostMessage; replay: boolean }
  | { ok: false; code: HandoffRuleCode };

/**
 * The second half, on the guest's tap: stores the Host message with the guest's (possibly edited)
 * text and consumes the pending record in one transaction, with the translation job and the host
 * notification. A repeat finds the record consumed and returns the same message.
 */
export async function completeHostMessage(
  deps: { db: Executor; queue: JobQueue; now: () => Date },
  input: { pendingId: string; spaceId: string; text: string },
): Promise<{ message: SentHostMessage; replay: boolean }> {
  // Failures are returned from the transaction, not thrown, so a release is not rolled back.
  const result = await deps.db.transaction(async (tx): Promise<Completion> => {
    const row = await lockPending(tx, input.pendingId);
    if (!row || row.spaceId !== input.spaceId || row.kind !== 'send_host_message') {
      return { ok: false, code: 'not-found' };
    }
    const draft = hostMessagePayload.parse(row.payload);
    if (row.state === 'consumed') {
      const [sent] = await tx
        .select()
        .from(handoffMessages)
        .where(eq(handoffMessages.id, draft.messageId));
      if (!sent) return { ok: false, code: 'not-found' };
      return { ok: true, message: sentMessage(sent), replay: true };
    }
    if (row.state === 'released') return { ok: false, code: 'released' };
    const now = deps.now();
    if (row.expiresAt <= now) {
      await markPending(tx, row.id, 'released', now);
      return { ok: false, code: 'expired' };
    }
    const text = input.text.trim();
    if (!text || text.length > HANDOFF_LIMITS.messageChars) {
      return { ok: false, code: 'invalid-input' };
    }
    const [target] = await tx
      .select({
        stayId: stays.id,
        unitId: units.id,
        guestLanguage: spaces.language,
        hostLanguage: accounts.uiLanguage,
      })
      .from(spaces)
      .innerJoin(stays, eq(stays.id, spaces.stayId))
      .innerJoin(units, eq(units.id, stays.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(accounts, eq(accounts.id, properties.hostId))
      .where(eq(spaces.id, row.spaceId));
    if (!target) return { ok: false, code: 'not-found' };
    const translationState =
      target.guestLanguage === target.hostLanguage ? 'not_needed' : 'pending';
    let sent: HandoffMessageRow | undefined;
    try {
      // A savepoint, so a lost race on the space's one message still lets us release the record.
      sent = await tx.transaction(async (sp) => {
        const [inserted] = await sp
          .insert(handoffMessages)
          .values({
            id: draft.messageId,
            spaceId: row.spaceId,
            stayId: target.stayId,
            unitId: target.unitId,
            reason: draft.reason,
            urgency: draft.urgency,
            guestLanguage: target.guestLanguage,
            text,
            hostLanguage: target.hostLanguage,
            translationState,
            sentAt: now,
          })
          .returning();
        return inserted;
      });
    } catch (error) {
      const e = error as { cause?: { constraint?: string }; constraint?: string };
      const constraint = e.cause?.constraint ?? e.constraint;
      if (pgCode(error) !== '23505' || constraint !== UNIQUE_SPACE) throw error;
      await markPending(tx, row.id, 'released', now);
      return { ok: false, code: 'already-sent' };
    }
    if (!sent) throw new Error('no handoff row');
    if (translationState === 'pending') {
      await deps.queue.send(QUEUES.translateHandoff, { handoffId: sent.id, part: 'message' }, tx, {
        id: uuidFrom(`handoff:${sent.id}:message`),
      });
    }
    // Always enqueued: the job decides at run time between now and the host's digest.
    await enqueueHostNotification(tx, deps.queue, { kind: 'message', handoffId: sent.id });
    await markPending(tx, row.id, 'consumed', now);
    return { ok: true, message: sentMessage(sent), replay: false };
  });
  if (!result.ok) throw new HandoffRuleError(result.code);
  return { message: result.message, replay: result.replay };
}

/** The space's sent Host message with this id; null when it is not theirs. */
export async function getSentHostMessage(
  db: Executor,
  spaceId: string,
  id: string,
): Promise<SentHostMessage | null> {
  const [row] = await db
    .select()
    .from(handoffMessages)
    .where(and(eq(handoffMessages.id, id), eq(handoffMessages.spaceId, spaceId)));
  return row ? sentMessage(row) : null;
}

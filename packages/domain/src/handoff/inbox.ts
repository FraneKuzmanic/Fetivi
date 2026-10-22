import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { appendInboxMessage, findConversation } from '../conversations/store';
import type { Executor } from '../db/client';
import { conversations, messages } from '../db/schema/conversations';
import { handoffMessages } from '../db/schema/handoff';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import { enqueueGuestNotification } from '../notifications/guest/enqueue';
import type { GuestLanguage } from '../property/vocabulary';
import { cleanText, HandoffRuleError } from './send';
import {
  HANDOFF_LIMITS,
  type HandoffReason,
  type HandoffTranslationState,
  type HandoffUrgency,
  INBOX_PART_TYPE,
} from './vocabulary';

// The host's inbox and the guest's side of it. "Hosts see only the messages guests explicitly
// send" (PRD §6.5): the host side reads `handoff_messages` only, never conversations.

export interface HostInboxMessage {
  id: string;
  unitName: string;
  propertyName: string;
  checkIn: string;
  checkout: string;
  bookerName: string | null;
  guestLanguage: GuestLanguage;
  hostLanguage: GuestLanguage;
  reason: HandoffReason;
  urgency: HandoffUrgency;
  text: string;
  translation: string | null;
  translationState: HandoffTranslationState;
  sentAt: string;
  readAt: string | null;
  reply: {
    text: string;
    repliedAt: string;
    translationState: HandoffTranslationState | null;
    deliveredAt: string | null;
  } | null;
}

/** The inbox message part a host reply becomes in the Conversation. */
export type InboxPart = {
  type: typeof INBOX_PART_TYPE;
  id: string;
  data: {
    kind: 'host-reply';
    handoffId: string;
    /** The translation, or the reply itself when none is shown. */
    text: string;
    /** The host's own words, only when a translation is shown. */
    original: string | null;
    repliedAt: string;
  };
};

const ownedBy = (hostId: string) => eq(properties.hostId, hostId);

function inboxQuery(db: Executor) {
  return db
    .select({
      m: handoffMessages,
      unitName: units.name,
      propertyName: properties.name,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      bookerName: stays.bookerName,
    })
    .from(handoffMessages)
    .innerJoin(units, eq(units.id, handoffMessages.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(stays, eq(stays.id, handoffMessages.stayId));
}

type InboxRow = Awaited<ReturnType<ReturnType<typeof inboxQuery>['execute']>>[number];

function toInboxMessage({ m, ...r }: InboxRow): HostInboxMessage {
  return {
    id: m.id,
    unitName: r.unitName,
    propertyName: r.propertyName,
    checkIn: r.checkIn,
    checkout: r.checkout,
    bookerName: r.bookerName,
    guestLanguage: m.guestLanguage,
    hostLanguage: m.hostLanguage,
    reason: m.reason,
    urgency: m.urgency,
    text: m.text,
    translation: m.translation,
    translationState: m.translationState,
    sentAt: m.sentAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
    reply:
      m.replyText && m.repliedAt
        ? {
            text: m.replyText,
            repliedAt: m.repliedAt.toISOString(),
            translationState: m.replyTranslationState,
            deliveredAt: m.replyDeliveredAt?.toISOString() ?? null,
          }
        : null,
  };
}

/** The host's Host messages: unread urgent ones first, then newest first. */
export async function listHostInbox(db: Executor, hostId: string): Promise<HostInboxMessage[]> {
  const rows = await inboxQuery(db)
    .where(ownedBy(hostId))
    .orderBy(
      desc(sql`(${handoffMessages.readAt} is null and ${handoffMessages.urgency} = 'urgent')`),
      desc(handoffMessages.sentAt),
      desc(handoffMessages.id),
    );
  return rows.map(toInboxMessage);
}

/** One of the host's Host messages; null when it is not theirs. */
export async function getHostInboxMessage(
  db: Executor,
  hostId: string,
  id: string,
): Promise<HostInboxMessage | null> {
  const [row] = await inboxQuery(db).where(and(ownedBy(hostId), eq(handoffMessages.id, id)));
  return row ? toInboxMessage(row) : null;
}

/** How many of the host's Host messages they have not opened. */
export async function unreadCount(db: Executor, hostId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(handoffMessages)
    .innerJoin(units, eq(units.id, handoffMessages.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(ownedBy(hostId), isNull(handoffMessages.readAt)));
  return row?.n ?? 0;
}

/** The host owns the message: its id, or `not-found`. Locks the row when `lock` is set. */
async function ownedMessage(db: Executor, hostId: string, id: string, lock = false) {
  const query = db
    .select({ m: handoffMessages })
    .from(handoffMessages)
    .innerJoin(units, eq(units.id, handoffMessages.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(ownedBy(hostId), eq(handoffMessages.id, id)));
  const [row] = lock ? await query.for('update', { of: handoffMessages }) : await query;
  if (!row) throw new HandoffRuleError('not-found');
  return row.m;
}

/** The host opened the message: Read, once. Callers pass only the host's own session here. */
export async function markHandoffRead(
  db: Executor,
  input: { hostId: string; id: string; now: Date },
): Promise<void> {
  await ownedMessage(db, input.hostId, input.id);
  await db
    .update(handoffMessages)
    .set({ readAt: input.now })
    .where(and(eq(handoffMessages.id, input.id), isNull(handoffMessages.readAt)));
}

/**
 * The host's one reply. Same language as the space: delivered to the guest's Chat in the same
 * transaction; otherwise a translation job delivers it. `markRead` is false for an admin acting
 * as the host: only the host's own session makes a message Read.
 */
export async function replyToHandoff(
  deps: { db: Executor; queue: JobQueue; now: () => Date },
  input: { hostId: string; accountId: string; id: string; text: string; markRead: boolean },
): Promise<HostInboxMessage> {
  const text = cleanText(input.text, HANDOFF_LIMITS.replyChars);
  await deps.db.transaction(async (tx) => {
    const row = await ownedMessage(tx, input.hostId, input.id, true);
    if (row.replyText !== null) throw new HandoffRuleError('already-replied');
    const [space] = await tx
      .select({ language: spaces.language })
      .from(spaces)
      .where(eq(spaces.id, row.spaceId));
    if (!space) throw new HandoffRuleError('not-found');
    const now = deps.now();
    const translate = space.language !== row.hostLanguage;
    await tx
      .update(handoffMessages)
      .set({
        replyText: text,
        repliedAt: now,
        repliedBy: input.accountId,
        replyLanguage: space.language,
        replyTranslationState: translate ? 'pending' : 'not_needed',
        ...(input.markRead ? { readAt: row.readAt ?? now } : {}),
      })
      .where(eq(handoffMessages.id, row.id));
    if (translate) {
      await deps.queue.send(QUEUES.translateHandoff, { handoffId: row.id, part: 'reply' }, tx, {
        id: uuidFrom(`handoff:${row.id}:reply`),
      });
    } else {
      await deliverReply(tx, deps.queue, row.id, { text, original: null }, now);
    }
  });
  const message = await getHostInboxMessage(deps.db, input.hostId, input.id);
  if (!message) throw new HandoffRuleError('not-found');
  return message;
}

/**
 * Puts the host's reply into the guest's Conversation as one inbox message and enqueues its email
 * and push in the same transaction. A second call (a retried job) is a no-op. Without a
 * Conversation there is no one to show it to.
 */
export async function deliverReply(
  tx: Executor,
  queue: JobQueue,
  handoffId: string,
  content: { text: string; original: string | null },
  now: Date,
): Promise<'delivered' | 'already-delivered' | 'no-conversation'> {
  const [row] = await tx
    .select()
    .from(handoffMessages)
    .where(eq(handoffMessages.id, handoffId))
    .for('update');
  if (!row?.repliedAt) throw new HandoffRuleError('not-found');
  if (row.replyDeliveredAt) return 'already-delivered';
  const conversation = await findConversation(tx, row.spaceId);
  if (!conversation) return 'no-conversation';
  const part: InboxPart = {
    type: INBOX_PART_TYPE,
    id: row.id,
    data: {
      kind: 'host-reply',
      handoffId: row.id,
      text: content.text,
      original: content.original,
      repliedAt: row.repliedAt.toISOString(),
    },
  };
  await appendInboxMessage(tx, {
    conversationId: conversation.id,
    id: randomUUID(),
    parts: [part],
    now,
  });
  await tx
    .update(handoffMessages)
    .set({ replyDeliveredAt: now })
    .where(eq(handoffMessages.id, row.id));
  await enqueueGuestNotification(tx, queue, {
    kind: 'host_reply',
    spaceId: row.spaceId,
    handoffId: row.id,
  });
  return 'delivered';
}

export interface GuestInboxState {
  /** Inbox messages since the guest last saw the Chat. */
  unread: number;
  /** "Sent" until the host opens it, then "Read". Never "seen". */
  handoffs: { id: string; status: 'sent' | 'read' }[];
}

export async function guestInboxState(db: Executor, spaceId: string): Promise<GuestInboxState> {
  const conversation = await findConversation(db, spaceId);
  let unread = 0;
  if (conversation) {
    const [row] = await db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          eq(messages.kind, 'inbox'),
          conversation.inboxSeenAt ? gt(messages.createdAt, conversation.inboxSeenAt) : undefined,
        ),
      );
    unread = row?.n ?? 0;
  }
  const handoffs = await db
    .select({ id: handoffMessages.id, readAt: handoffMessages.readAt })
    .from(handoffMessages)
    .where(eq(handoffMessages.spaceId, spaceId));
  return {
    unread,
    handoffs: handoffs.map((h) => ({ id: h.id, status: h.readAt ? 'read' : 'sent' })),
  };
}

/** The guest has seen the Chat: the badge counts from now. */
export async function markInboxSeen(db: Executor, spaceId: string, now: Date): Promise<void> {
  await db
    .update(conversations)
    .set({ inboxSeenAt: now })
    .where(eq(conversations.spaceId, spaceId));
}

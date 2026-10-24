import { and, asc, eq, max } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import {
  type ConversationRow,
  conversations,
  type MessagePart,
  type MessageRow,
  messages,
} from '../db/schema/conversations';
import { recordAnswers } from '../feedback/store';
import type { GuestProjection } from '../projection/projection';
import { recordContentGaps } from '../suggestions/host/store';

export class ConversationRuleError extends Error {
  override name = 'ConversationRuleError';
  constructor(readonly code: 'not-found') {
    super(code);
  }
}

/** The Space's conversation, or null before its first turn. */
export async function findConversation(
  db: Executor,
  spaceId: string,
): Promise<ConversationRow | null> {
  const [row] = await db.select().from(conversations).where(eq(conversations.spaceId, spaceId));
  return row ?? null;
}

/**
 * The Space's one conversation, created on first use. `init` is used only for a new row: an
 * existing conversation keeps its system prompt byte for byte.
 */
export async function getOrCreateConversation(
  db: Executor,
  spaceId: string,
  init: { systemPrompt: string; projection: GuestProjection },
  now: Date,
): Promise<ConversationRow> {
  await db
    .insert(conversations)
    .values({ spaceId, ...init, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: conversations.spaceId });
  const row = await findConversation(db, spaceId);
  if (!row) throw new ConversationRuleError('not-found');
  return row;
}

/** The conversation's messages in order. */
export async function loadMessages(db: Executor, conversationId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.seq));
}

export interface AppendTurnInput {
  conversationId: string;
  messages: { id: string; role: MessageRow['role']; parts: MessagePart[] }[];
  /**
   * Messages already stored whose parts are replaced: a paused tool call answered or cancelled,
   * or an assistant message a resumed turn continued.
   */
  updated?: { id: string; parts: MessagePart[] }[];
  /** The projection the model has now been given. */
  projection: GuestProjection;
  situationNote: string | null;
  aboutMeNote: string | null;
  /** The seq up to which host replies are now noted; left as it is when omitted. */
  hostReplyNotedSeq?: number;
  /** The weather note the model has now been given; left as it is when omitted. */
  weatherNote?: string | null;
  now: Date;
}

/** Locks the conversation row; seq allocation and turn writes serialise here. */
async function lockConversation(tx: Executor, conversationId: string): Promise<void> {
  const [locked] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for('update');
  if (!locked) throw new ConversationRuleError('not-found');
}

/** The next free seq; call under the conversation row lock. */
async function nextSeq(tx: Executor, conversationId: string): Promise<number> {
  const [last] = await tx
    .select({ seq: max(messages.seq) })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return (last?.seq ?? 0) + 1;
}

/**
 * Stores one completed turn's messages after the existing ones, replaces the parts of the
 * `updated` ones, and records what the model now knows.
 */
export async function appendTurn(db: Db, input: AppendTurnInput): Promise<void> {
  await db.transaction(async (tx) => {
    await lockConversation(tx, input.conversationId);
    const answers: { id: string; parts: MessagePart[] }[] = [];
    for (const m of input.updated ?? []) {
      const [row] = await tx
        .update(messages)
        .set({ parts: m.parts })
        .where(and(eq(messages.id, m.id), eq(messages.conversationId, input.conversationId)))
        .returning({ id: messages.id, role: messages.role, kind: messages.kind });
      // Thrown inside the transaction, so nothing of the turn is written.
      if (!row) throw new ConversationRuleError('not-found');
      if (row.role === 'assistant' && row.kind === 'chat') answers.push(m);
    }
    const start = await nextSeq(tx, input.conversationId);
    if (input.messages.length) {
      await tx.insert(messages).values(
        input.messages.map((m, i) => ({
          id: m.id,
          conversationId: input.conversationId,
          seq: start + i,
          role: m.role,
          parts: m.parts,
          createdAt: input.now,
        })),
      );
    }
    // 43: one feedback row per assistant answer, topics recomputed from the full parts.
    answers.push(...input.messages.filter((m) => m.role === 'assistant'));
    await recordAnswers(tx, input.conversationId, answers, input.now);
    // 44: property facts Fetivi could not answer, as topic codes per Stay.
    await recordContentGaps(tx, input.conversationId, answers, input.now);
    await tx
      .update(conversations)
      .set({
        projection: input.projection,
        situationNote: input.situationNote,
        aboutMeNote: input.aboutMeNote,
        ...(input.hostReplyNotedSeq === undefined
          ? {}
          : { hostReplyNotedSeq: input.hostReplyNotedSeq }),
        ...(input.weatherNote === undefined ? {} : { weatherNote: input.weatherNote }),
        updatedAt: input.now,
      })
      .where(eq(conversations.id, input.conversationId));
  });
}

/**
 * Appends one inbox message (a host reply) after the existing messages. It is shown to the guest
 * and counted by the Chat badge; the model never sees it as a conversation message (ADR 0006).
 */
export async function appendInboxMessage(
  tx: Executor,
  input: { conversationId: string; id: string; parts: MessagePart[]; now: Date },
): Promise<void> {
  await lockConversation(tx, input.conversationId);
  await tx.insert(messages).values({
    id: input.id,
    conversationId: input.conversationId,
    seq: await nextSeq(tx, input.conversationId),
    role: 'assistant',
    kind: 'inbox',
    parts: input.parts,
    createdAt: input.now,
  });
}

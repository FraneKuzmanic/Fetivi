import { and, asc, eq, max } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import {
  type ConversationRow,
  conversations,
  type MessagePart,
  type MessageRow,
  messages,
} from '../db/schema/conversations';
import type { GuestProjection } from '../projection/projection';

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
  now: Date;
}

/**
 * Stores one completed turn's messages after the existing ones, replaces the parts of the
 * `updated` ones, and records what the model now knows.
 */
export async function appendTurn(db: Db, input: AppendTurnInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .for('update');
    if (!locked) throw new ConversationRuleError('not-found');
    for (const m of input.updated ?? []) {
      const [row] = await tx
        .update(messages)
        .set({ parts: m.parts })
        .where(and(eq(messages.id, m.id), eq(messages.conversationId, input.conversationId)))
        .returning({ id: messages.id });
      // Thrown inside the transaction, so nothing of the turn is written.
      if (!row) throw new ConversationRuleError('not-found');
    }
    const [last] = await tx
      .select({ seq: max(messages.seq) })
      .from(messages)
      .where(eq(messages.conversationId, input.conversationId));
    const start = (last?.seq ?? 0) + 1;
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
    await tx
      .update(conversations)
      .set({
        projection: input.projection,
        situationNote: input.situationNote,
        aboutMeNote: input.aboutMeNote,
        updatedAt: input.now,
      })
      .where(eq(conversations.id, input.conversationId));
  });
}

import { and, count, eq, gte } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { conversations, messages } from '../db/schema/conversations';
import { getPlatformSettings } from '../settings/store';
import { startOfCivilDay, toLocalDateTime } from '../time';

export interface CapInput {
  spaceId: string;
  /** The property's IANA zone: the cap resets at its midnight. */
  zone: string;
  now: Date;
}

/**
 * The guest's typed chat messages stored since the start of the property's current day. A user
 * message is stored only when its turn completes, and card answers store none, so neither counts.
 */
export async function messagesToday(
  db: Executor,
  { spaceId, zone, now }: CapInput,
): Promise<number> {
  const today = toLocalDateTime(now, zone).slice(0, 10);
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.spaceId, spaceId),
        eq(messages.role, 'user'),
        eq(messages.kind, 'chat'),
        gte(messages.createdAt, startOfCivilDay(today, zone)),
      ),
    );
  return row?.n ?? 0;
}

/** True once the Space has sent the admin's daily cap of messages today. */
export async function capReached(db: Executor, input: CapInput): Promise<boolean> {
  const [sent, settings] = await Promise.all([messagesToday(db, input), getPlatformSettings(db)]);
  return sent >= settings.dailyMessageCap;
}

import { and, eq, isNull, min } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { handoffMessages } from '../../db/schema/handoff';
import { hostNotificationSettings } from '../../db/schema/notifications';
import { properties, units } from '../../db/schema/properties';
import { hostTimezone } from './settings';
import { dueDigestSlot } from './slots';

/**
 * The digests due at `now`: one per Digest-mode host whose latest slot has a pending message
 * (normal, unread, unclaimed) sent at or before it. A message sent after the slot waits for the
 * next one; a missed cron run catches up because the latest slot stays due until the next.
 */
export async function dueDigests(
  db: Executor,
  now: Date,
): Promise<{ hostId: string; slot: string }[]> {
  const hosts = await db
    .select({
      hostId: hostNotificationSettings.hostId,
      digestTimes: hostNotificationSettings.digestTimes,
      oldestPending: min(handoffMessages.sentAt),
    })
    .from(hostNotificationSettings)
    .innerJoin(properties, eq(properties.hostId, hostNotificationSettings.hostId))
    .innerJoin(units, eq(units.propertyId, properties.id))
    .innerJoin(handoffMessages, eq(handoffMessages.unitId, units.id))
    .where(
      and(
        eq(hostNotificationSettings.mode, 'digest'),
        isNull(handoffMessages.hostNotificationKey),
        isNull(handoffMessages.readAt),
        eq(handoffMessages.urgency, 'normal'),
      ),
    )
    .groupBy(hostNotificationSettings.hostId, hostNotificationSettings.digestTimes);
  const due: { hostId: string; slot: string }[] = [];
  for (const host of hosts) {
    if (!host.oldestPending) continue;
    const slot = dueDigestSlot(host.digestTimes, await hostTimezone(db, host.hostId), now);
    if (slot && host.oldestPending.getTime() <= slot.getTime()) {
      due.push({ hostId: host.hostId, slot: slot.toISOString() });
    }
  }
  return due;
}

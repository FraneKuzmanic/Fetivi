import type { Executor } from '../db/client';
import { platformSettings } from '../db/schema/settings';
import { DEFAULT_DAILY_MESSAGE_CAP, MESSAGE_CAP_LIMITS } from './vocabulary';

export interface PlatformSettings {
  dailyMessageCap: number;
}

/** The admin's settings, or the defaults when none were saved. */
export async function getPlatformSettings(db: Executor): Promise<PlatformSettings> {
  const [row] = await db
    .select({ dailyMessageCap: platformSettings.dailyMessageCap })
    .from(platformSettings);
  return { dailyMessageCap: row?.dailyMessageCap ?? DEFAULT_DAILY_MESSAGE_CAP };
}

export async function setDailyMessageCap(
  db: Executor,
  cap: number,
  now: Date,
): Promise<PlatformSettings> {
  if (!Number.isInteger(cap) || cap < MESSAGE_CAP_LIMITS.min || cap > MESSAGE_CAP_LIMITS.max) {
    throw new RangeError(`daily message cap out of range: ${cap}`);
  }
  await db
    .insert(platformSettings)
    .values({ id: 1, dailyMessageCap: cap, updatedAt: now })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: { dailyMessageCap: cap, updatedAt: now },
    });
  return { dailyMessageCap: cap };
}

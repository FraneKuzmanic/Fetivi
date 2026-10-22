import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client';
import { hostNotificationSettings } from '../../db/schema/notifications';
import { properties } from '../../db/schema/properties';
import {
  DEFAULT_DIGEST_TIMES,
  DEFAULT_HOST_DELIVERY_MODE,
  DEFAULT_HOST_TIMEZONE,
  DIGEST_LIMITS,
  DIGEST_TIME,
  HOST_DELIVERY_MODES,
  type HostDeliveryMode,
} from './vocabulary';

/** What the host saves: the mode and 1–6 'HH:MM' times, stored sorted and distinct. */
export const hostNotificationSettingsInput = z
  .strictObject({
    mode: z.enum(HOST_DELIVERY_MODES),
    digestTimes: z
      .array(z.string().regex(DIGEST_TIME))
      .min(DIGEST_LIMITS.minTimes)
      .max(DIGEST_LIMITS.maxTimes),
  })
  // Deduping a non-empty list leaves at least one time, so no second length check is needed.
  .transform((input) => ({ ...input, digestTimes: [...new Set(input.digestTimes)].sort() }));

export type HostNotificationSettingsInput = z.output<typeof hostNotificationSettingsInput>;

export interface HostNotificationSettings {
  mode: HostDeliveryMode;
  digestTimes: string[];
  /** The clock the digest times are read in. */
  timezone: string;
}

/** The timezone of the host's oldest property, else the default. One clock per host. */
export async function hostTimezone(db: Executor, hostId: string): Promise<string> {
  const [oldest] = await db
    .select({ timezone: properties.timezone })
    .from(properties)
    .where(eq(properties.hostId, hostId))
    .orderBy(asc(properties.createdAt), asc(properties.id))
    .limit(1);
  return oldest?.timezone ?? DEFAULT_HOST_TIMEZONE;
}

/** The host's settings, or the defaults when they never saved any. */
export async function getHostNotificationSettings(
  db: Executor,
  hostId: string,
): Promise<HostNotificationSettings> {
  const [row] = await db
    .select({
      mode: hostNotificationSettings.mode,
      digestTimes: hostNotificationSettings.digestTimes,
    })
    .from(hostNotificationSettings)
    .where(eq(hostNotificationSettings.hostId, hostId));
  return {
    mode: row?.mode ?? DEFAULT_HOST_DELIVERY_MODE,
    digestTimes: row?.digestTimes ?? [...DEFAULT_DIGEST_TIMES],
    timezone: await hostTimezone(db, hostId),
  };
}

/** Saves the settings; digest times are kept in Immediate mode so switching back restores them. */
export async function saveHostNotificationSettings(
  db: Executor,
  hostId: string,
  input: HostNotificationSettingsInput,
  now: Date,
): Promise<HostNotificationSettings> {
  const values = { mode: input.mode, digestTimes: input.digestTimes, updatedAt: now };
  await db
    .insert(hostNotificationSettings)
    .values({ hostId, ...values })
    .onConflictDoUpdate({ target: hostNotificationSettings.hostId, set: values });
  return getHostNotificationSettings(db, hostId);
}

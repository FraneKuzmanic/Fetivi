import { and, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { findDestinationAt } from '../catalog/destination';
import type { Executor } from '../db/client';
import { conversations, messages } from '../db/schema/conversations';
import { guestNotificationDeliveries } from '../db/schema/notifications';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { dailyTipKey } from '../notifications/guest/enqueue';
import type { GuestLanguage } from '../property/vocabulary';
import type { CivilDate } from '../time';
import { ACTIVE_WITHIN_MS, TIP_SEND_TIME, TIP_SEND_UNTIL } from './vocabulary';

// Which spaces get a daily tip now. Read fresh on every cron run: the job id and the ledger make
// a repeated run send nothing twice, and the ledger check here saves the searches on later runs.

export interface DueTipSpace {
  spaceId: string;
  stayId: string;
  propertyId: string;
  destinationId: string;
  language: GuestLanguage;
  /** The property's IANA zone. */
  zone: string;
  /** Today in property time: the tip's key. */
  sendDate: CivilDate;
  /** The day the tip is about. */
  tomorrow: CivilDate;
  /** Tomorrow is a full Stay day (before checkout day). */
  fullDay: boolean;
}

/**
 * Open spaces of non-cancelled Stays inside a destination, between 17:00 and 21:00 property time
 * on a send day (check-in to the day before checkout), that chatted in the last 48 hours or opted
 * in to tip emails with a verified address, and have no tip for today yet.
 */
export async function dueTipSpaces(db: Executor, now: Date): Promise<DueTipSpace[]> {
  const activeSince = new Date(now.getTime() - ACTIVE_WITHIN_MS);
  // Any zone's local date is within a day of the UTC date.
  const utc = DateTime.fromJSDate(now, { zone: 'utc' });
  const chattedRecently = sql`exists (
    select 1 from ${messages}
    inner join ${conversations} on ${conversations.id} = ${messages.conversationId}
    where ${conversations.spaceId} = ${spaces.id}
      and ${messages.role} = 'user' and ${messages.kind} = 'chat'
      and ${messages.createdAt} > ${activeSince})`;
  const candidates = await db
    .select({
      spaceId: spaces.id,
      stayId: stays.id,
      propertyId: properties.id,
      language: spaces.language,
      zone: properties.timezone,
      location: properties.location,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
    })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        gt(spaces.closedAt, now),
        eq(stays.possiblyCancelled, false),
        lte(stays.checkIn, sql`${utc.plus({ days: 1 }).toISODate()}::date`),
        gte(stays.checkout, sql`${utc.toISODate()}::date`),
        sql`(${chattedRecently} or (${spaces.tipsEmailOptInAt} is not null and ${spaces.emailVerifiedAt} is not null))`,
      ),
    );

  const inWindow = candidates.flatMap((c) => {
    const local = DateTime.fromJSDate(now, { zone: c.zone });
    const time = local.toFormat('HH:mm');
    if (time < TIP_SEND_TIME || time >= TIP_SEND_UNTIL) return [];
    const sendDate = local.toISODate() as CivilDate;
    const lastSendDay = DateTime.fromISO(c.checkout).minus({ days: 1 }).toISODate() as CivilDate;
    // ISO civil dates compare correctly as strings.
    if (sendDate < c.checkIn || sendDate > lastSendDay) return [];
    const tomorrow = local.plus({ days: 1 }).toISODate() as CivilDate;
    return [{ ...c, sendDate, tomorrow, fullDay: tomorrow < c.checkout }];
  });
  if (inWindow.length === 0) return [];

  const sent = await db
    .selectDistinct({ key: guestNotificationDeliveries.key })
    .from(guestNotificationDeliveries)
    .where(
      inArray(
        guestNotificationDeliveries.key,
        inWindow.map((c) => dailyTipKey(c.spaceId, c.sendDate)),
      ),
    );
  const sentKeys = new Set(sent.map((r) => r.key));

  const destinationOf = new Map<string, Promise<string | null>>();
  const due: DueTipSpace[] = [];
  for (const c of inWindow) {
    if (sentKeys.has(dailyTipKey(c.spaceId, c.sendDate))) continue;
    // wgs84Point is { x: lng, y: lat }; a property without a location is outside every destination.
    const location = c.location;
    if (!location) continue;
    let lookup = destinationOf.get(c.propertyId);
    if (!lookup) {
      lookup = findDestinationAt(db, { lat: location.y, lng: location.x }).then(
        (d) => d?.id ?? null,
      );
      destinationOf.set(c.propertyId, lookup);
    }
    const destinationId = await lookup;
    if (!destinationId) continue;
    due.push({
      spaceId: c.spaceId,
      stayId: c.stayId,
      propertyId: c.propertyId,
      destinationId,
      language: c.language,
      zone: c.zone,
      sendDate: c.sendDate,
      tomorrow: c.tomorrow,
      fullDay: c.fullDay,
    });
  }
  return due;
}

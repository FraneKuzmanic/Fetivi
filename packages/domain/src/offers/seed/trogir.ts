import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db } from '../../db/client';
import { destinations } from '../../db/schema/catalog';
import { providers } from '../../db/schema/offers';
import type { JobQueue } from '../../jobs/queue';
import { addAllotmentSlots, expandWeeklySchedule } from '../slots';
import { createOffer } from '../store';

const PROVIDER_NAME = 'Mare Trogir Boats';

/**
 * Development fixture: one Provider in Trogir with an allotment boat trip (daily 09:00 slots for
 * the 60 days after `now`) and an on-request cruise. Fictional data; the `.example` address never
 * receives mail. Runs through the normal write path, so each Offer's translation is enqueued.
 * Skips when the Provider exists.
 */
export async function seedTrogirServices(
  db: Db,
  queue: JobQueue,
  now: Date,
  destinationId: string,
): Promise<{ providerId: string; created: boolean }> {
  const [existing] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.name, PROVIDER_NAME));
  if (existing) return { providerId: existing.id, created: false };

  const [destination] = await db
    .select({ timezone: destinations.timezone })
    .from(destinations)
    .where(eq(destinations.id, destinationId));
  if (!destination) throw new Error(`destination ${destinationId} not found`);

  const [provider] = await db
    .insert(providers)
    .values({
      name: PROVIDER_NAME,
      email: 'bookings@mare-trogir-boats.example',
      commissionBp: 1_500,
      dealNotes: 'Development fixture.',
    })
    .returning();
  if (!provider) throw new Error('provider insert returned nothing');
  const owner = { providerId: provider.id, destinationId };

  const boatTrip = await createOffer(
    db,
    queue,
    {
      ...owner,
      title: 'Blue Lagoon and Šolta boat trip',
      description:
        'A full-day boat trip from Trogir harbour to the Blue Lagoon on Drvenik Veli and the fishing village of Maslinica on Šolta.\n\nSwimming stops, lunch on board and drinks are included. Bring a towel and sun cream.',
      cancellationPolicy:
        'Free cancellation up to 24 hours before departure. After that, no refund.',
      category: 'boat_trip',
      orderKind: 'booking',
      availabilityMode: 'allotment',
      paymentMode: 'direct',
      priceMinor: 4_500,
      priceUnit: 'person',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      contactFields: 'name_and_phone',
    },
    now,
  );
  const tomorrow = DateTime.fromJSDate(now, { zone: destination.timezone })
    .plus({ days: 1 })
    .toISODate();
  const last = DateTime.fromJSDate(now, { zone: destination.timezone })
    .plus({ days: 60 })
    .toISODate();
  if (!tomorrow || !last) throw new Error('invalid seed clock');
  const { startsAt } = expandWeeklySchedule(
    { from: tomorrow, to: last, weekdays: [1, 2, 3, 4, 5, 6, 7], times: ['09:00'] },
    destination.timezone,
  );
  await addAllotmentSlots(db, boatTrip.id, startsAt, 12, now);

  await createOffer(
    db,
    queue,
    {
      ...owner,
      title: 'Private sunset cruise',
      description:
        'A private two-hour cruise along the Trogir riviera at sunset, for up to eight people.\n\nThe skipper picks the route on the day; a glass of local wine is included.',
      cancellationPolicy: 'Free cancellation up to 48 hours before; after that 50 % is refunded.',
      category: 'boat_trip',
      orderKind: 'booking',
      availabilityMode: 'on_request',
      paymentMode: 'direct',
      priceMinor: 25_000,
      priceUnit: 'group',
      freeCancelHoursBefore: 48,
      refundPercentAfter: 50,
      contactFields: 'name',
    },
    now,
  );

  return { providerId: provider.id, created: true };
}

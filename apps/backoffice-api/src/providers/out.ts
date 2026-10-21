import {
  type AllotmentSlotRow,
  allotmentSlots,
  catalogRecords,
  type DestinationRow,
  destinations,
  type Executor,
  type OfferRow,
  offers,
  type ProviderRow,
  providers,
  toLocalDateTime,
} from '@fetivi/domain';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { HttpError } from '../http-error';

// Reads and response shapes of the Provider and Offer routes. Slot times go out as wall-clock
// strings in the Offer's destination zone. Every Provider Offer has a destination (CHECK), so the
// reads inner-join it; host Offers (ticket 38) bring the property's zone with them.

const notFound = () => new HttpError(404, 'not-found');

export function providerOut(row: ProviderRow, offerCount = 0) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    whatsappPhone: row.whatsappPhone,
    language: row.language,
    taxNumber: row.taxNumber,
    commissionBp: row.commissionBp,
    dealNotes: row.dealNotes,
    /** The raw Stripe id is not exposed. */
    stripeConnected: row.stripeAccountId !== null,
    active: row.active,
    offerCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Qualified by hand: in a single-table select Drizzle leaves column names bare, and a bare "id"
// would bind to offers inside the subquery.
const offerCount = sql<number>`(select count(*)::int from ${offers} where ${offers}.provider_id = ${providers}.id)`;

export async function listProviders(db: Executor) {
  const rows = await db
    .select({ provider: providers, offerCount })
    .from(providers)
    .orderBy(asc(providers.name));
  return rows.map((r) => providerOut(r.provider, r.offerCount));
}

export async function findProvider(db: Executor, id: string) {
  const [row] = await db
    .select({ provider: providers, offerCount })
    .from(providers)
    .where(eq(providers.id, id));
  if (!row) throw notFound();
  return row;
}

export async function findOffer(db: Executor, id: string) {
  const [row] = await db
    .select({ offer: offers, provider: providers, destination: destinations })
    .from(offers)
    .leftJoin(providers, eq(offers.providerId, providers.id))
    .innerJoin(destinations, eq(offers.destinationId, destinations.id))
    .where(eq(offers.id, id));
  if (!row) throw notFound();
  return row;
}

export function offerSummaryOut(offer: OfferRow, destination: DestinationRow) {
  return {
    id: offer.id,
    providerId: offer.providerId,
    destination: { id: destination.id, name: destination.name },
    title: offer.title,
    category: offer.category,
    orderKind: offer.orderKind,
    availabilityMode: offer.availabilityMode,
    paymentMode: offer.paymentMode,
    priceMinor: offer.priceMinor,
    currency: offer.currency,
    priceUnit: offer.priceUnit,
    active: offer.active,
    translation: {
      status: offer.translationStatus,
      error: offer.translationError,
      revision: offer.revision,
      publishedRevision: offer.publishedRevision,
    },
  };
}

export async function offerDetail(
  db: Executor,
  offer: OfferRow,
  provider: ProviderRow | null,
  destination: DestinationRow,
) {
  const [place] = offer.placeId
    ? await db
        .select({ id: catalogRecords.id, title: catalogRecords.title })
        .from(catalogRecords)
        .where(eq(catalogRecords.id, offer.placeId))
    : [];
  return {
    ...offerSummaryOut(offer, destination),
    provider: provider ? { id: provider.id, name: provider.name } : null,
    timezone: destination.timezone,
    description: offer.description,
    cancellationPolicy: offer.cancellationPolicy,
    placeId: offer.placeId,
    place: place ?? null,
    freeCancelHoursBefore: offer.freeCancelHoursBefore,
    refundPercentAfter: offer.refundPercentAfter,
    responseWindowMinutes: offer.responseWindowMinutes,
    responseHoursFrom: offer.responseHoursFrom.slice(0, 5),
    responseHoursTo: offer.responseHoursTo.slice(0, 5),
    contactFields: offer.contactFields,
    adapterKind: offer.adapterKind,
    externalProductRef: offer.externalProductRef,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

export async function listProviderOffers(db: Executor, providerId: string) {
  const rows = await db
    .select({ offer: offers, destination: destinations })
    .from(offers)
    .innerJoin(destinations, eq(offers.destinationId, destinations.id))
    .where(eq(offers.providerId, providerId))
    .orderBy(asc(offers.title));
  return rows.map((r) => offerSummaryOut(r.offer, r.destination));
}

export function slotOut(row: AllotmentSlotRow, zone: string) {
  return {
    id: row.id,
    startsAt: toLocalDateTime(row.startsAt, zone),
    capacity: row.capacity,
    remaining: row.remaining,
  };
}

/** Upcoming slots soonest first, or past slots latest first; at most 500. */
export async function listSlots(
  db: Executor,
  offerId: string,
  zone: string,
  now: Date,
  past: boolean,
) {
  const rows = await db
    .select()
    .from(allotmentSlots)
    .where(
      and(
        eq(allotmentSlots.offerId, offerId),
        past ? lt(allotmentSlots.startsAt, now) : gte(allotmentSlots.startsAt, now),
      ),
    )
    .orderBy(past ? desc(allotmentSlots.startsAt) : asc(allotmentSlots.startsAt))
    .limit(500);
  return rows.map((r) => slotOut(r, zone));
}

/** A slot with its Offer's zone, for responses. */
export async function findSlotZone(db: Executor, slotId: string) {
  const [row] = await db
    .select({ timezone: destinations.timezone })
    .from(allotmentSlots)
    .innerJoin(offers, eq(allotmentSlots.offerId, offers.id))
    .innerJoin(destinations, eq(offers.destinationId, destinations.id))
    .where(eq(allotmentSlots.id, slotId));
  if (!row) throw notFound();
  return row.timezone;
}

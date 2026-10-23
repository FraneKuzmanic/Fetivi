import { allotmentSlots, type Executor, type OfferRow, offers } from '@fetivi/domain';
import { and, asc, eq } from 'drizzle-orm';
import { HttpError } from '../http-error';

// Reads and response shapes of a host's own Offers (38). The keys match the admin Offer detail so
// the web reuses its type: an own Offer has no Provider, destination or place, so those are null,
// and slot times are in the host's zone (`hostTimezone`).

const notFound = () => new HttpError(404, 'not-found');

export function hostOfferSummaryOut(offer: OfferRow) {
  return {
    id: offer.id,
    providerId: null,
    destination: null,
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

export function hostOfferOut(offer: OfferRow, timezone: string) {
  return {
    ...hostOfferSummaryOut(offer),
    provider: null,
    timezone,
    description: offer.description,
    cancellationPolicy: offer.cancellationPolicy,
    placeId: null,
    place: null,
    freeCancelHoursBefore: offer.freeCancelHoursBefore,
    refundPercentAfter: offer.refundPercentAfter,
    responseWindowMinutes: offer.responseWindowMinutes,
    responseHoursFrom: offer.responseHoursFrom.slice(0, 5),
    responseHoursTo: offer.responseHoursTo.slice(0, 5),
    contactFields: offer.contactFields,
    adapterKind: null,
    externalProductRef: null,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

/** The host's own Offer; another host's or a Provider's is 404. */
export async function findHostOffer(db: Executor, hostId: string, id: string): Promise<OfferRow> {
  const [offer] = await db
    .select()
    .from(offers)
    .where(and(eq(offers.id, id), eq(offers.hostId, hostId)));
  if (!offer) throw notFound();
  return offer;
}

export async function listHostOffers(db: Executor, hostId: string) {
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.hostId, hostId))
    .orderBy(asc(offers.title), asc(offers.id));
  return rows.map(hostOfferSummaryOut);
}

/** 404 unless the slot belongs to one of the host's own Offers. */
export async function assertHostSlot(db: Executor, hostId: string, slotId: string) {
  const [row] = await db
    .select({ id: allotmentSlots.id })
    .from(allotmentSlots)
    .innerJoin(offers, eq(offers.id, allotmentSlots.offerId))
    .where(and(eq(allotmentSlots.id, slotId), eq(offers.hostId, hostId)));
  if (!row) throw notFound();
}

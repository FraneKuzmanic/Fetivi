import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { offers, offerTranslations, providers } from '../db/schema/offers';
import { type GuestOfferScope, visibleOfferCondition } from './visibility';
import type {
  AvailabilityMode,
  ContactFields,
  OfferCategory,
  OrderKind,
  PaymentMode,
  PriceUnit,
} from './vocabulary';

// The guest read side of Offers; who sees what is `visibleOfferCondition` (visibility.ts).

export type { GuestOfferScope };

export interface GuestOffer {
  id: string;
  /** Published translation, guest language. */
  title: string;
  description: string;
  cancellationPolicy: string;
  category: OfferCategory;
  orderKind: OrderKind;
  availabilityMode: AvailabilityMode;
  paymentMode: PaymentMode;
  /** In cents per `priceUnit`; null for request-kind Offers. */
  priceMinor: number | null;
  currency: string;
  priceUnit: PriceUnit;
  contactFields: ContactFields;
  placeId: string | null;
  owner: 'provider' | 'host';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const translationJoin = (scope: GuestOfferScope) =>
  and(
    eq(offerTranslations.offerId, offers.id),
    eq(offerTranslations.revision, offers.publishedRevision),
    eq(offerTranslations.language, scope.language),
  );

const columns = {
  id: offers.id,
  title: offerTranslations.title,
  description: offerTranslations.body,
  cancellationPolicy: offerTranslations.cancellationPolicy,
  category: offers.category,
  orderKind: offers.orderKind,
  availabilityMode: offers.availabilityMode,
  paymentMode: offers.paymentMode,
  priceMinor: offers.priceMinor,
  currency: offers.currency,
  priceUnit: offers.priceUnit,
  contactFields: offers.contactFields,
  placeId: offers.placeId,
  providerId: offers.providerId,
};

function selectGuestOffers(db: Executor, scope: GuestOfferScope, extra: (SQL | undefined)[]) {
  return db
    .select(columns)
    .from(offers)
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .innerJoin(offerTranslations, translationJoin(scope))
    .where(and(visibleOfferCondition(scope), ...extra));
}

function guestOfferOf({
  providerId,
  ...rest
}: Awaited<ReturnType<typeof selectGuestOffers>>[number]): GuestOffer {
  return { ...rest, owner: providerId ? 'provider' : 'host' };
}

/** The Offers this guest may see, by translated title. */
export async function listGuestOffers(
  db: Executor,
  scope: GuestOfferScope,
  filter: { category?: OfferCategory; placeId?: string } = {},
): Promise<GuestOffer[]> {
  if (filter.placeId !== undefined && !UUID.test(filter.placeId)) return [];
  const rows = await selectGuestOffers(db, scope, [
    filter.category ? eq(offers.category, filter.category) : undefined,
    filter.placeId ? eq(offers.placeId, filter.placeId) : undefined,
  ]).orderBy(asc(offerTranslations.title), asc(offers.id));
  return rows.map(guestOfferOf);
}

/** One Offer when this guest may see it, else null. */
export async function getGuestOffer(
  db: Executor,
  scope: GuestOfferScope,
  offerId: string,
): Promise<GuestOffer | null> {
  if (!UUID.test(offerId)) return null;
  const [row] = await selectGuestOffers(db, scope, [eq(offers.id, offerId)]);
  return row ? guestOfferOf(row) : null;
}

/** The visible Offers linked to each of `placeIds`, for the bookable boost. */
export async function offerIdsByPlace(
  db: Executor,
  scope: GuestOfferScope,
  placeIds: string[],
): Promise<Map<string, string[]>> {
  const byPlace = new Map<string, string[]>();
  if (placeIds.length === 0) return byPlace;
  const rows = await db
    .select({ id: offers.id, placeId: offers.placeId })
    .from(offers)
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .where(and(visibleOfferCondition(scope), inArray(offers.placeId, placeIds)))
    .orderBy(asc(offers.id));
  for (const r of rows) {
    if (!r.placeId) continue;
    byPlace.set(r.placeId, [...(byPlace.get(r.placeId) ?? []), r.id]);
  }
  return byPlace;
}

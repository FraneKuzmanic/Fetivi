import { and, eq, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { hostHiddenProviders, offers, providers } from '../db/schema/offers';
import { properties } from '../db/schema/properties';
import type { GuestLanguage } from '../property/vocabulary';

// The one guest visibility rule (authorization matrix, architecture §4.3; ADR 0031). An Offer is
// visible to a guest when all of these hold:
//   1. Active: the Offer is switched on.
//   2. Published: it has a published revision (all seven guest languages exist).
//   3. In the guest's language: a translation exists for the published revision in the guest's
//      language. Applied by the readers' translation join in guest.ts.
//   4. Owner: either the host's own service (any of the host's properties, inside or outside a
//      destination), or, only inside a destination, a Provider Offer of that destination
//      5. whose Provider is active, and
//      6. which the property's host has not hidden (38).
// Never looks at commission or dates. Order and the guest's category/place filters:
// listGuestOffers. Booking adds the bookability checks in services/pending/create-order.ts.

/** Who is asking: the token's destination (null outside one), property and language. */
export interface GuestOfferScope {
  destinationId: string | null;
  propertyId: string;
  language: GuestLanguage;
}

/** An Offer that is switched on and has a published revision (all seven languages): filters 1-2. */
export function activePublishedOffer(): SQL | undefined {
  return and(eq(offers.active, true), isNotNull(offers.publishedRevision));
}

/** Published, active Offers this guest may see; `providers` must be left-joined. */
export function visibleOfferCondition(scope: GuestOfferScope): SQL | undefined {
  const ownHost = eq(
    offers.hostId,
    sql`(select ${properties.hostId} from ${properties} where ${properties.id} = ${scope.propertyId})`,
  );
  // Qualified by hand so the bare names can't bind to the wrong table inside the subquery.
  const notHidden = sql`not exists (select 1 from ${hostHiddenProviders} h where h.host_id = (select p.host_id from ${properties} p where p.id = ${scope.propertyId}) and h.provider_id = ${offers}.provider_id)`;
  const destination =
    scope.destinationId === null
      ? undefined
      : and(
          isNotNull(offers.providerId),
          eq(offers.destinationId, scope.destinationId),
          eq(providers.active, true),
          notHidden,
        );
  return and(activePublishedOffer(), destination ? or(ownHost, destination) : ownHost);
}

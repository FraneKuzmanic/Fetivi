import { and, eq, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { hostHiddenProviders, offers, providers } from '../db/schema/offers';
import { properties } from '../db/schema/properties';
import type { GuestLanguage } from '../property/vocabulary';

// The one guest visibility rule (authorization matrix, architecture §4.3): inside a destination,
// the destination's Provider Offers the host has not hidden (38) plus the host's own; outside
// one, only the host's own. Visibility never looks at commission.

/** Who is asking: the token's destination (null outside one), property and language. */
export interface GuestOfferScope {
  destinationId: string | null;
  propertyId: string;
  language: GuestLanguage;
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
  return and(
    eq(offers.active, true),
    isNotNull(offers.publishedRevision),
    destination ? or(ownHost, destination) : ownHost,
  );
}

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { findDestinationAt } from '../catalog/destination';
import type { Executor } from '../db/client';
import { destinations } from '../db/schema/catalog';
import { hostHiddenProviders, offers, providers } from '../db/schema/offers';
import { properties } from '../db/schema/properties';
import { OfferRuleError } from './store';

// Host control over Providers (38, PRD §6.4): every approved Provider near the host's properties
// is shown to their guests unless the host hides it. Per host; existing Orders are untouched.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HostProvider {
  id: string;
  name: string;
  /** Active, published Offers in the host's destinations. */
  offerCount: number;
  /** Names of the host's destinations the Provider has those Offers in. */
  destinations: string[];
  hidden: boolean;
}

/** The destinations the host's guests are in: each located property's, as the guest side finds it. */
export async function hostDestinations(
  db: Executor,
  hostId: string,
): Promise<{ id: string; name: string }[]> {
  const located = await db
    .select({ location: properties.location })
    .from(properties)
    .where(and(eq(properties.hostId, hostId), isNotNull(properties.location)));
  const byId = new Map<string, string>();
  for (const { location } of located) {
    if (!location) continue;
    // wgs84Point is { x: lng, y: lat }.
    const found = await findDestinationAt(db, { lat: location.y, lng: location.x });
    if (found) byId.set(found.id, found.name);
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The approved Providers the host's guests may see: active, with at least one active, published
 * Offer in one of the host's destinations. Never commission, deal notes or email.
 */
export async function listHostProviders(db: Executor, hostId: string): Promise<HostProvider[]> {
  const destinationIds = (await hostDestinations(db, hostId)).map((d) => d.id);
  if (destinationIds.length === 0) return [];
  return db
    .select({
      id: providers.id,
      name: providers.name,
      offerCount: sql<number>`count(distinct ${offers.id})::int`,
      destinations: sql<
        string[]
      >`array_agg(distinct ${destinations.name} order by ${destinations.name})`,
      hidden: sql<boolean>`bool_or(${hostHiddenProviders.hostId} is not null)`,
    })
    .from(providers)
    .innerJoin(offers, eq(offers.providerId, providers.id))
    .innerJoin(destinations, eq(destinations.id, offers.destinationId))
    .leftJoin(
      hostHiddenProviders,
      and(eq(hostHiddenProviders.providerId, providers.id), eq(hostHiddenProviders.hostId, hostId)),
    )
    .where(
      and(
        eq(providers.active, true),
        eq(offers.active, true),
        isNotNull(offers.publishedRevision),
        inArray(offers.destinationId, destinationIds),
      ),
    )
    .groupBy(providers.id, providers.name)
    .orderBy(asc(providers.name));
}

/** Hides or shows a listed Provider for the host's guests. Idempotent; unlisted → not-found. */
export async function setProviderHidden(
  db: Executor,
  hostId: string,
  providerId: string,
  hidden: boolean,
  now: Date,
): Promise<HostProvider> {
  const listed = UUID.test(providerId)
    ? (await listHostProviders(db, hostId)).find((p) => p.id === providerId)
    : undefined;
  if (!listed) throw new OfferRuleError('not-found');
  if (hidden) {
    await db
      .insert(hostHiddenProviders)
      .values({ hostId, providerId, createdAt: now })
      .onConflictDoNothing();
  } else {
    await db
      .delete(hostHiddenProviders)
      .where(
        and(eq(hostHiddenProviders.hostId, hostId), eq(hostHiddenProviders.providerId, providerId)),
      );
  }
  return { ...listed, hidden };
}

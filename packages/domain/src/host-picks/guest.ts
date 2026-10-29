import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { OpenState } from '../catalog/calendar';
import type { CatalogScope, PlaceDetail, PlaceSummary } from '../catalog/search';
import { kmOf, latLngOf, type Origin, originGeog, summaryOf } from '../catalog/summary';
import type { PlaceCategory } from '../catalog/vocabulary';
import type { Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';

// The guest read side of host places (40). Only the guests of the host place's own property see
// it, in their language, at the published revision. A host-added place lies in the guest's
// destination and is shown until the catalog record its suggestion became is visible; from then
// on it reads as a pick of that record.

/**
 * The picked records among `recordIds` for this property, each with its note in the guest's
 * language. A note that is the record's description (a host-added place approved as is, ADR
 * 0018) is dropped, so the card does not say it twice.
 */
export async function hostPicksFor(
  db: Executor,
  scope: CatalogScope,
  recordIds: string[],
): Promise<Map<string, { note: string | null }>> {
  if (recordIds.length === 0) return new Map();
  const rows = await db
    .select({
      recordId: hostPlaces.catalogRecordId,
      note: hostPlaceTranslations.note,
      repeats: sql<boolean>`${hostPlaces.note} = ${catalogRecords.description}`,
    })
    .from(hostPlaces)
    .innerJoin(catalogRecords, eq(catalogRecords.id, hostPlaces.catalogRecordId))
    .leftJoin(
      hostPlaceTranslations,
      and(
        eq(hostPlaceTranslations.hostPlaceId, hostPlaces.id),
        eq(hostPlaceTranslations.revision, hostPlaces.publishedRevision),
        eq(hostPlaceTranslations.language, scope.language),
      ),
    )
    .where(
      and(
        eq(hostPlaces.propertyId, scope.propertyId),
        inArray(hostPlaces.catalogRecordId, recordIds),
      ),
    );
  return new Map(
    rows.flatMap((r) =>
      r.recordId ? [[r.recordId, { note: r.repeats ? null : r.note || null }] as const] : [],
    ),
  );
}

/** The record a promoted host place links to is visible to this guest (search.ts's visibleIn). */
const recordVisible = (scope: CatalogScope) =>
  sql`exists (select 1 from catalog_records r
      where r.id = "host_places"."catalog_record_id"
        and r.destination_id = ${scope.destinationId}
        and r.published_revision is not null
        and r.kind in ('place', 'day_trip'))`;

/** Host-added places this guest may see (see the file comment). */
const addedVisibleTo = (scope: CatalogScope) =>
  and(
    eq(hostPlaces.propertyId, scope.propertyId),
    isNotNull(hostPlaces.name),
    isNotNull(hostPlaces.publishedRevision),
    sql`exists (select 1 from destinations d
        where d.id = ${scope.destinationId}
          and ST_DWithin("host_places"."location"::geography, d.centre::geography, d.radius_m))`,
    sql`(${hostPlaces.catalogRecordId} is null or not ${recordVisible(scope)})`,
  );

const addedJoin = (scope: CatalogScope) =>
  and(
    eq(hostPlaceTranslations.hostPlaceId, hostPlaces.id),
    eq(hostPlaceTranslations.revision, hostPlaces.publishedRevision),
    eq(hostPlaceTranslations.language, scope.language),
  );

const distanceOf = (origin: Origin) => {
  const g = originGeog(origin);
  return g
    ? sql<number | null>`ST_Distance(${hostPlaces.location}::geography, ${g})`
    : sql<number | null>`null::float8`;
};

const addedColumns = (origin: Origin) => ({
  id: hostPlaces.id,
  placeCategory: hostPlaces.placeCategory,
  location: hostPlaces.location,
  address: hostPlaces.address,
  name: hostPlaceTranslations.name,
  note: hostPlaceTranslations.note,
  createdAt: hostPlaces.createdAt,
  distanceM: distanceOf(origin),
});

export interface HostAddedRow {
  id: string;
  placeCategory: PlaceCategory | null;
  location: { x: number; y: number } | null;
  address: string | null;
  name: string;
  note: string;
  createdAt: Date;
  distanceM: unknown;
}

/**
 * This property's visible host-added places that pass the search filters other than the words;
 * search scores the words (catalog/relevance.ts).
 */
export async function hostAddedCandidates(
  db: Executor,
  scope: CatalogScope,
  origin: Origin,
  q: { category?: PlaceCategory | 'day_trip'; maxDistanceKm?: number },
): Promise<HostAddedRow[]> {
  // A host-added place is never a day trip.
  if (q.category === 'day_trip') return [];
  const geog = originGeog(origin);
  return db
    .select(addedColumns(origin))
    .from(hostPlaces)
    .innerJoin(hostPlaceTranslations, addedJoin(scope))
    .where(
      and(
        addedVisibleTo(scope),
        q.category ? eq(hostPlaces.placeCategory, q.category) : undefined,
        q.maxDistanceKm === undefined
          ? undefined
          : geog
            ? sql`ST_DWithin(${hostPlaces.location}::geography, ${geog}, ${q.maxDistanceKm * 1000})`
            : sql`false`,
      ),
    )
    .orderBy(asc(hostPlaces.createdAt), asc(hostPlaces.id));
}

/** The fields a host-added summary and detail share: unverified, no photo, not bookable. */
const addedBaseOf = (r: HostAddedRow) => ({
  id: r.id,
  kind: 'place' as const,
  category: r.placeCategory as PlaceCategory,
  title: r.name,
  location: latLngOf(r.location),
  distanceKm: kmOf(r.distanceM),
  travelMinutes: null,
  address: r.address,
  phone: null,
  websiteUrl: null,
  image: null,
  verifiedAt: null,
  staleness: { status: 'never_verified' as const, staleAt: null },
  sources: [],
  hostPick: { note: r.note || null },
  hostAdded: true,
});

/** A host-added place as a search result; it has no hours, so an asked time is 'unknown'. */
export function toHostAddedSummary(r: HostAddedRow, openAsked: boolean): PlaceSummary {
  const open: OpenState | null = openAsked ? 'unknown' : null;
  return { ...addedBaseOf(r), summary: summaryOf(r.note), open, offerIds: [] };
}

/** One host-added place in full; null when this guest may not see it. */
export async function getHostAddedPlace(
  db: Executor,
  scope: CatalogScope,
  origin: Origin,
  id: string,
): Promise<PlaceDetail | null> {
  const [r] = await db
    .select(addedColumns(origin))
    .from(hostPlaces)
    .innerJoin(hostPlaceTranslations, addedJoin(scope))
    .where(and(addedVisibleTo(scope), eq(hostPlaces.id, id)));
  if (!r) return null;
  return {
    ...addedBaseOf(r),
    description: r.note,
    seasons: [],
    openingHours: [],
    inSeasonToday: true,
    images: [],
  };
}

/** This property's picks of records visible to the guest, in the order they were added. */
export async function visiblePickIds(
  db: Executor,
  scope: CatalogScope,
): Promise<{ recordId: string; createdAt: Date }[]> {
  const rows = await db
    .select({ recordId: hostPlaces.catalogRecordId, createdAt: hostPlaces.createdAt })
    .from(hostPlaces)
    .where(
      and(
        eq(hostPlaces.propertyId, scope.propertyId),
        isNotNull(hostPlaces.catalogRecordId),
        recordVisible(scope),
      ),
    )
    .orderBy(asc(hostPlaces.createdAt), asc(hostPlaces.id));
  return rows.flatMap((r) =>
    r.recordId ? [{ recordId: r.recordId, createdAt: r.createdAt }] : [],
  );
}

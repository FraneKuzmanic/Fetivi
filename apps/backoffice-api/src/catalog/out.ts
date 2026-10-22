import {
  accounts,
  type CatalogKind,
  type CatalogRecordRow,
  catalogOpeningHours,
  catalogRecords,
  catalogSeasons,
  type DestinationRow,
  destinations,
  type Executor,
  placeImages,
  stalenessOf,
  toLocalDateTime,
} from '@fetivi/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HttpError } from '../http-error';

// Reads and response shapes of the catalog routes. Points go out as { lat, lng }; event times as
// wall-clock strings in the destination's zone.

const notFound = () => new HttpError(404, 'not-found');
const latLngOf = (p: { x: number; y: number } | null) => (p ? { lat: p.y, lng: p.x } : null);
const pad = (n: number) => String(n).padStart(2, '0');

export function destinationOut(row: DestinationRow, recordCount = 0) {
  return {
    id: row.id,
    name: row.name,
    centre: { lat: row.centre.y, lng: row.centre.x },
    radiusKm: row.radiusM / 1000,
    timezone: row.timezone,
    recordCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Qualified by hand: in a single-table select Drizzle leaves column names bare, and a bare "id"
// would bind to catalog_records inside the subquery.
const recordCount = sql<number>`(select count(*)::int from ${catalogRecords} where ${catalogRecords}.destination_id = ${destinations}.id)`;

export async function listDestinations(db: Executor) {
  const rows = await db
    .select({ destination: destinations, recordCount })
    .from(destinations)
    .orderBy(asc(destinations.name));
  return rows.map((r) => destinationOut(r.destination, r.recordCount));
}

export async function findDestination(db: Executor, id: string) {
  const [row] = await db
    .select({ destination: destinations, recordCount })
    .from(destinations)
    .where(eq(destinations.id, id));
  if (!row) throw notFound();
  return row;
}

export async function findRecord(db: Executor, id: string) {
  const [row] = await db
    .select({ record: catalogRecords, destination: destinations })
    .from(catalogRecords)
    .innerJoin(destinations, eq(catalogRecords.destinationId, destinations.id))
    .where(eq(catalogRecords.id, id));
  if (!row) throw notFound();
  return row;
}

export function recordSummaryOut(row: CatalogRecordRow, destination: DestinationRow, now: Date) {
  const local = (d: Date | null) => (d ? toLocalDateTime(d, destination.timezone) : null);
  const staleness = stalenessOf(row, now);
  return {
    id: row.id,
    destinationId: row.destinationId,
    kind: row.kind,
    placeCategory: row.placeCategory,
    title: row.title,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    staleness: { status: staleness.status, staleAt: staleness.staleAt?.toISOString() ?? null },
    translation: {
      status: row.translationStatus,
      error: row.translationError,
      revision: row.revision,
      publishedRevision: row.publishedRevision,
    },
    startsAt: local(row.startsAt),
    endsAt: local(row.endsAt),
  };
}

export async function recordDetail(
  db: Executor,
  row: CatalogRecordRow,
  destination: DestinationRow,
  now: Date,
) {
  const [seasons, hours, images, verifier] = await Promise.all([
    db
      .select()
      .from(catalogSeasons)
      .where(eq(catalogSeasons.recordId, row.id))
      .orderBy(asc(catalogSeasons.fromMonth), asc(catalogSeasons.fromDay)),
    db
      .select()
      .from(catalogOpeningHours)
      .where(eq(catalogOpeningHours.recordId, row.id))
      .orderBy(asc(catalogOpeningHours.weekday), asc(catalogOpeningHours.opens)),
    db
      .select()
      .from(placeImages)
      .where(eq(placeImages.recordId, row.id))
      .orderBy(asc(placeImages.position)),
    row.verifiedBy
      ? db.select({ email: accounts.email }).from(accounts).where(eq(accounts.id, row.verifiedBy))
      : Promise.resolve([]),
  ]);
  return {
    ...recordSummaryOut(row, destination, now),
    destination: { id: destination.id, name: destination.name, timezone: destination.timezone },
    description: row.description,
    location: latLngOf(row.location),
    address: row.address,
    phone: row.phone,
    websiteUrl: row.websiteUrl,
    venueName: row.venueName,
    transportMode: row.transportMode,
    links: row.links,
    travelMinutes: row.travelMinutes,
    ferryLines: row.ferryLines,
    fieldSources: row.fieldSources,
    /** Null for the seed or a deleted account. */
    verifiedByEmail: verifier[0]?.email ?? null,
    seasons: seasons.map((s) => ({
      from: `${pad(s.fromMonth)}-${pad(s.fromDay)}`,
      to: `${pad(s.toMonth)}-${pad(s.toDay)}`,
    })),
    openingHours: hours.map((h) => ({
      weekday: h.weekday,
      opens: h.opens.slice(0, 5),
      closes: h.closes.slice(0, 5),
      validFrom: h.validFrom,
      validTo: h.validTo,
    })),
    images: images.map((i) => ({
      url: i.url,
      source: i.source,
      licence: i.licence,
      attribution: i.attribution,
      sourcePageUrl: i.sourcePageUrl,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRecords(
  db: Executor,
  destination: DestinationRow,
  kind: CatalogKind | undefined,
  now: Date,
) {
  const rows = await db
    .select()
    .from(catalogRecords)
    .where(
      and(
        eq(catalogRecords.destinationId, destination.id),
        kind ? eq(catalogRecords.kind, kind) : undefined,
      ),
    )
    .orderBy(asc(catalogRecords.kind), asc(catalogRecords.title));
  return rows.map((r) => recordSummaryOut(r, destination, now));
}

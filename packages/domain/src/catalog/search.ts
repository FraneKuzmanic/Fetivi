import { and, asc, eq, gt, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db, Executor } from '../db/client';
import {
  type CatalogOpeningHoursRow,
  type CatalogSeasonRow,
  catalogOpeningHours,
  catalogRecommendations,
  catalogRecords,
  catalogSeasons,
  catalogTranslations,
  destinations,
  type PlaceImageRow,
  placeImages,
} from '../db/schema/catalog';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import { offerIdsByPlace } from '../offers/guest';
import type { GuestLanguage } from '../property/vocabulary';
import { type CivilDate, toLocalDateTime } from '../time';
import { inSeason, monthDayOf, type OpenState, openStateAt } from './calendar';
import { type AboutMeFit, rankPlaces } from './ranking';
import { stalenessOf } from './staleness';
import type {
  CatalogKind,
  ImageSource,
  PlaceCategory,
  StalenessStatus,
  TransportMode,
} from './vocabulary';

// The guest read side of the catalog: only the token's destination, only published records, in
// the guest's language. Filters SQL can do cheaply run in SQL; wrapping seasons and overnight
// hours run in TS on the small remaining set.

/** Who is asking: the token's destination, property, Stay and language. */
export interface CatalogScope {
  destinationId: string;
  propertyId: string;
  stayId: string;
  language: GuestLanguage;
  /** From the Space's About me (aboutMeFit); null when nothing ranks. */
  aboutMe: AboutMeFit | null;
}

/** The lowest `word_similarity` a record needs to match a guest's words; unrelated prose scores ~0.4. */
export const TEXT_MATCH_MIN = 0.5;

export interface LatLng {
  lat: number;
  lng: number;
}
export interface CatalogStaleness {
  status: StalenessStatus;
  staleAt: string | null;
}
export interface CatalogSource {
  field: string;
  url: string;
}
export interface CatalogImage {
  url: string;
  source: ImageSource;
  licence: string | null;
  attribution: string | null;
  sourcePageUrl: string | null;
}

export interface PlaceSummary {
  id: string;
  kind: 'place' | 'day_trip';
  category: PlaceCategory | 'day_trip';
  /** Published translation, guest language. */
  title: string;
  summary: string;
  location: LatLng | null;
  /** From the property, rounded to 0.1 km. */
  distanceKm: number | null;
  travelMinutes: number | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  image: CatalogImage | null;
  /** Null when no time was asked about. */
  open: OpenState | null;
  verifiedAt: string | null;
  staleness: CatalogStaleness;
  sources: CatalogSource[];
  /** In-scope Offers that can be arranged here; non-empty is the "arrange it here" marker. */
  offerIds: string[];
}

export interface PlaceQuery {
  query?: string;
  category?: PlaceCategory | 'day_trip';
  maxDistanceKm?: number;
  date?: CivilDate;
  /** 'HH:MM' local time on `date`. */
  openAt?: string;
  limit?: number;
}

export interface PlaceSearch {
  date: CivilDate;
  openAt: string | null;
  results: PlaceSummary[];
}

export interface PlaceDetail extends Omit<PlaceSummary, 'open' | 'summary' | 'offerIds'> {
  /** Full translated Markdown. */
  description: string;
  seasons: { from: string; to: string }[];
  openingHours: {
    weekday: number;
    opens: string;
    closes: string;
    validFrom: string | null;
    validTo: string | null;
  }[];
  inSeasonToday: boolean;
  images: CatalogImage[];
}

export interface EventSummary {
  id: string;
  title: string;
  summary: string;
  /** 'YYYY-MM-DDTHH:mm' in the destination's zone. */
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  location: LatLng | null;
  distanceKm: number | null;
  websiteUrl: string | null;
  verifiedAt: string | null;
  staleness: CatalogStaleness;
  sources: CatalogSource[];
}

export interface EventSearch {
  /** The Stay's event window: 3 days before check-in to 3 days after checkout. */
  window: { from: CivilDate; to: CivilDate };
  results: EventSummary[];
}

export interface TransportNote {
  id: string;
  mode: TransportMode;
  title: string;
  /** Full translated Markdown. */
  description: string;
  links: { label: string; url: string }[];
  verifiedAt: string | null;
  staleness: CatalogStaleness;
  sources: CatalogSource[];
}

interface Origin {
  location: { x: number; y: number } | null;
  checkIn: CivilDate;
  checkout: CivilDate;
  zone: string;
}

/** The property's location, the Stay's dates and the destination's zone; null on a broken chain. */
async function loadOrigin(db: Executor, scope: CatalogScope): Promise<Origin | null> {
  const [row] = await db
    .select({
      location: properties.location,
      propertyId: units.propertyId,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      zone: destinations.timezone,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(destinations, eq(destinations.id, scope.destinationId))
    .where(eq(stays.id, scope.stayId));
  if (!row || row.propertyId !== scope.propertyId) return null;
  return { location: row.location, checkIn: row.checkIn, checkout: row.checkout, zone: row.zone };
}

const todayIn = (now: Date, zone: string): CivilDate =>
  DateTime.fromJSDate(now, { zone }).toISODate() as CivilDate;

/** The day a season check is for: the asked date, else today, but not before check-in. */
function seasonDate(origin: Origin, now: Date, date?: CivilDate): CivilDate {
  if (date) return date;
  const today = todayIn(now, origin.zone);
  return today > origin.checkIn ? today : origin.checkIn;
}

const originGeog = (o: Origin) =>
  o.location
    ? sql`ST_SetSRID(ST_MakePoint(${o.location.x}::float8, ${o.location.y}::float8), 4326)::geography`
    : null;

const distanceOf = (o: Origin) => {
  const g = originGeog(o);
  return g
    ? sql<number | null>`ST_Distance(${catalogRecords.location}::geography, ${g})`
    : sql<number | null>`null::float8`;
};

/**
 * The best trigram match of the words against every published translation, the source language
 * among them. The record's own title and description are left out: they may hold an unpublished edit.
 */
function textScoreOf(query: string | undefined): SQL<number> | null {
  const q = query?.trim().toLowerCase();
  if (!q) return null;
  return sql<number>`coalesce((select max(greatest(word_similarity(${q}::text, x.title), word_similarity(${q}::text, x.body)))
      from catalog_translations x
      where x.record_id = ${catalogRecords.id} and x.revision = ${catalogRecords.publishedRevision}), 0)`;
}

const textMatches = (textScore: SQL<number> | null) =>
  textScore ? sql`${textScore} >= ${TEXT_MATCH_MIN}` : undefined;

/** Published records of the scope's destination; `translationJoin` picks the guest's language. */
const visibleIn = (scope: CatalogScope) =>
  and(
    eq(catalogRecords.destinationId, scope.destinationId),
    isNotNull(catalogRecords.publishedRevision),
  );

const translationJoin = (scope: CatalogScope) =>
  and(
    eq(catalogTranslations.recordId, catalogRecords.id),
    eq(catalogTranslations.revision, catalogRecords.publishedRevision),
    eq(catalogTranslations.language, scope.language),
  );

const latLngOf = (p: { x: number; y: number } | null): LatLng | null =>
  p ? { lat: p.y, lng: p.x } : null;

const kmOf = (m: unknown): number | null =>
  m === null || m === undefined ? null : Math.round(Number(m) / 100) / 10;

const sourcesOf = (fieldSources: Partial<Record<string, string>>): CatalogSource[] =>
  Object.entries(fieldSources).flatMap(([field, url]) => (url ? [{ field, url }] : []));

function stalenessFor(
  r: {
    kind: CatalogKind;
    placeCategory: PlaceCategory | null;
    verifiedAt: Date | null;
    endsAt: Date | null;
  },
  now: Date,
): CatalogStaleness {
  const s = stalenessOf(r, now);
  return { status: s.status, staleAt: s.staleAt?.toISOString() ?? null };
}

/** The first non-empty paragraph without Markdown markers, at most 280 characters. */
function summaryOf(markdown: string): string {
  const paragraph =
    markdown
      .split(/\n\s*\n/)
      .map((p) =>
        p
          .replace(/^\s*(?:[#>*-]+\s*)+/gm, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .find(Boolean) ?? '';
  if (paragraph.length <= 280) return paragraph;
  const cut = paragraph.slice(0, 279);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const imageOf = (i: PlaceImageRow): CatalogImage => ({
  url: i.url,
  source: i.source,
  licence: i.licence,
  attribution: i.attribution,
  sourcePageUrl: i.sourcePageUrl,
});

async function rowsFor(db: Executor, ids: string[]) {
  if (ids.length === 0) {
    return {
      seasons: [] as CatalogSeasonRow[],
      hours: [] as CatalogOpeningHoursRow[],
      images: [] as PlaceImageRow[],
    };
  }
  const [seasons, hours, images] = await Promise.all([
    db.select().from(catalogSeasons).where(inArray(catalogSeasons.recordId, ids)),
    db.select().from(catalogOpeningHours).where(inArray(catalogOpeningHours.recordId, ids)),
    db
      .select()
      .from(placeImages)
      .where(inArray(placeImages.recordId, ids))
      .orderBy(asc(placeImages.position), asc(placeImages.id)),
  ]);
  return { seasons, hours, images };
}

const byRecord = <T extends { recordId: string }>(rows: T[], id: string) =>
  rows.filter((r) => r.recordId === id);

interface PlaceRow {
  id: string;
  kind: CatalogKind;
  placeCategory: PlaceCategory | null;
  title: string;
  location: { x: number; y: number } | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  travelMinutes: number | null;
  verifiedAt: Date | null;
  fieldSources: Partial<Record<string, string>>;
  distanceM: unknown;
}

/** The fields a place summary and a place detail share. */
const placeBaseOf = (r: PlaceRow, now: Date) => ({
  id: r.id,
  kind: r.kind as 'place' | 'day_trip',
  category: r.kind === 'day_trip' ? ('day_trip' as const) : (r.placeCategory as PlaceCategory),
  title: r.title,
  location: latLngOf(r.location),
  distanceKm: kmOf(r.distanceM),
  travelMinutes: r.travelMinutes,
  address: r.address,
  phone: r.phone,
  websiteUrl: r.websiteUrl,
  verifiedAt: r.verifiedAt?.toISOString() ?? null,
  staleness: stalenessFor({ ...r, endsAt: null }, now),
  sources: sourcesOf(r.fieldSources),
});

const placeColumns = (origin: Origin) => ({
  id: catalogRecords.id,
  kind: catalogRecords.kind,
  placeCategory: catalogRecords.placeCategory,
  title: catalogTranslations.title,
  body: catalogTranslations.body,
  location: catalogRecords.location,
  address: catalogRecords.address,
  phone: catalogRecords.phone,
  websiteUrl: catalogRecords.websiteUrl,
  travelMinutes: catalogRecords.travelMinutes,
  verifiedAt: catalogRecords.verifiedAt,
  fieldSources: catalogRecords.fieldSources,
  distanceM: distanceOf(origin),
});

/**
 * Places and day trips in the guest's destination, in season on the asked day (default today,
 * or check-in before arrival), ranked best first. Counts a recommendation for every result.
 * Null when the token's Stay, unit and property do not belong together.
 */
export async function searchPlaces(
  db: Db,
  scope: CatalogScope,
  q: PlaceQuery,
  now: Date,
): Promise<PlaceSearch | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
  const date = seasonDate(origin, now, q.date);
  const textScore = textScoreOf(q.query);
  const geog = originGeog(origin);

  const conditions: (SQL | undefined)[] = [
    visibleIn(scope),
    inArray(catalogRecords.kind, ['place', 'day_trip']),
  ];
  if (q.category === 'day_trip') conditions.push(eq(catalogRecords.kind, 'day_trip'));
  else if (q.category) conditions.push(eq(catalogRecords.placeCategory, q.category));
  if (q.maxDistanceKm !== undefined) {
    conditions.push(
      geog
        ? sql`ST_DWithin(${catalogRecords.location}::geography, ${geog}, ${q.maxDistanceKm * 1000})`
        : sql`false`,
    );
  }
  conditions.push(textMatches(textScore));

  const rows = await db
    .select({ ...placeColumns(origin), textScore: textScore ?? sql<null>`null` })
    .from(catalogRecords)
    .innerJoin(catalogTranslations, translationJoin(scope))
    .where(and(...conditions));

  const { seasons, hours, images } = await rowsFor(
    db,
    rows.map((r) => r.id),
  );
  const md = monthDayOf(date);
  const offerIds = await offerIdsByPlace(
    db,
    { destinationId: scope.destinationId, propertyId: scope.propertyId, language: scope.language },
    rows.map((r) => r.id),
  );
  const candidates = rows.flatMap((r) => {
    if (!inSeason(byRecord(seasons, r.id), md)) return [];
    const open = q.openAt ? openStateAt(byRecord(hours, r.id), date, q.openAt) : null;
    if (open === 'closed') return [];
    const base = placeBaseOf(r, now);
    const image = images.find((i) => i.recordId === r.id);
    const bookableHere = offerIds.get(r.id) ?? [];
    const summary: PlaceSummary = {
      ...base,
      summary: summaryOf(r.body),
      image: image ? imageOf(image) : null,
      open,
      offerIds: bookableHere,
    };
    return [
      {
        summary,
        id: r.id,
        category: base.category,
        textScore: r.textScore === null ? null : Number(r.textScore),
        staleness: base.staleness.status,
        distanceM: r.distanceM === null ? null : Number(r.distanceM),
        // Only candidates that passed every filter above get here: the boost is among results that fit.
        bookable: bookableHere.length > 0,
      },
    ];
  });

  const results = rankPlaces(candidates, scope.aboutMe)
    .slice(0, q.limit ?? 5)
    .map((c) => c.summary);
  await recordRecommendations(
    db,
    results.map((r) => r.id),
    todayIn(now, origin.zone),
  );
  return { date, openAt: q.openAt ?? null, results };
}

/** One place or day trip in full; null when it is not visible to this guest. */
export async function getPlace(
  db: Db,
  scope: CatalogScope,
  id: string,
  now: Date,
): Promise<PlaceDetail | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
  const [r] = await db
    .select(placeColumns(origin))
    .from(catalogRecords)
    .innerJoin(catalogTranslations, translationJoin(scope))
    .where(
      and(
        visibleIn(scope),
        eq(catalogRecords.id, id),
        inArray(catalogRecords.kind, ['place', 'day_trip']),
      ),
    );
  if (!r) return null;
  const { seasons, hours, images } = await rowsFor(db, [r.id]);
  const mmdd = (m: number, d: number) =>
    `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return {
    ...placeBaseOf(r, now),
    description: r.body,
    image: images[0] ? imageOf(images[0]) : null,
    images: images.map(imageOf),
    seasons: seasons.map((s) => ({
      from: mmdd(s.fromMonth, s.fromDay),
      to: mmdd(s.toMonth, s.toDay),
    })),
    openingHours: hours
      .sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens))
      .map((h) => ({
        weekday: h.weekday,
        opens: h.opens.slice(0, 5),
        closes: h.closes.slice(0, 5),
        validFrom: h.validFrom,
        validTo: h.validTo,
      })),
    inSeasonToday: inSeason(seasons, monthDayOf(seasonDate(origin, now))),
  };
}

/**
 * Events overlapping the Stay ± 3 days that have not ended, soonest first. `from`/`to` narrow
 * that window and never widen it.
 */
export async function searchEvents(
  db: Db,
  scope: CatalogScope,
  q: { query?: string; from?: CivilDate; to?: CivilDate },
  now: Date,
): Promise<EventSearch | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
  const day = (d: CivilDate) => DateTime.fromISO(d, { zone: origin.zone }).startOf('day');
  const windowStart = day(origin.checkIn).minus({ days: 3 });
  const windowLast = day(origin.checkout).plus({ days: 3 });
  const window = {
    from: windowStart.toISODate() as CivilDate,
    to: windowLast.toISODate() as CivilDate,
  };
  const windowEnd = windowLast.plus({ days: 1 }).startOf('day');
  const start = q.from && day(q.from) > windowStart ? day(q.from) : windowStart;
  const askedEnd = q.to ? day(q.to).plus({ days: 1 }).startOf('day') : windowEnd;
  const end = askedEnd < windowEnd ? askedEnd : windowEnd;
  if (start >= end) return { window, results: [] };

  const textScore = textScoreOf(q.query);
  const rows = await db
    .select({
      id: catalogRecords.id,
      kind: catalogRecords.kind,
      placeCategory: catalogRecords.placeCategory,
      title: catalogTranslations.title,
      body: catalogTranslations.body,
      startsAt: catalogRecords.startsAt,
      endsAt: catalogRecords.endsAt,
      venueName: catalogRecords.venueName,
      location: catalogRecords.location,
      distanceM: distanceOf(origin),
      websiteUrl: catalogRecords.websiteUrl,
      verifiedAt: catalogRecords.verifiedAt,
      fieldSources: catalogRecords.fieldSources,
    })
    .from(catalogRecords)
    .innerJoin(catalogTranslations, translationJoin(scope))
    .where(
      and(
        visibleIn(scope),
        eq(catalogRecords.kind, 'event'),
        lt(catalogRecords.startsAt, end.toJSDate()),
        gt(catalogRecords.endsAt, start.toJSDate()),
        gt(catalogRecords.endsAt, now),
        textMatches(textScore),
      ),
    )
    .orderBy(asc(catalogRecords.startsAt), asc(catalogRecords.id))
    .limit(10);

  return {
    window,
    results: rows.map((r) => {
      // The event CHECK guarantees both instants.
      const startsAt = r.startsAt as Date;
      const endsAt = r.endsAt as Date;
      return {
        id: r.id,
        title: r.title,
        summary: summaryOf(r.body),
        startsAt: toLocalDateTime(startsAt, origin.zone),
        endsAt: toLocalDateTime(endsAt, origin.zone),
        venueName: r.venueName,
        location: latLngOf(r.location),
        distanceKm: kmOf(r.distanceM),
        websiteUrl: r.websiteUrl,
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        staleness: stalenessFor(r, now),
        sources: sourcesOf(r.fieldSources),
      };
    }),
  };
}

/** Curated transport notes in season, as stored: text and links, nothing computed. */
export async function listTransportNotes(
  db: Db,
  scope: CatalogScope,
  q: { mode?: TransportMode; query?: string },
  now: Date,
): Promise<TransportNote[] | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
  const textScore = textScoreOf(q.query);
  const rows = await db
    .select({
      id: catalogRecords.id,
      kind: catalogRecords.kind,
      placeCategory: catalogRecords.placeCategory,
      mode: catalogRecords.transportMode,
      title: catalogTranslations.title,
      body: catalogTranslations.body,
      links: catalogRecords.links,
      verifiedAt: catalogRecords.verifiedAt,
      fieldSources: catalogRecords.fieldSources,
    })
    .from(catalogRecords)
    .innerJoin(catalogTranslations, translationJoin(scope))
    .where(
      and(
        visibleIn(scope),
        eq(catalogRecords.kind, 'transport_note'),
        q.mode ? eq(catalogRecords.transportMode, q.mode) : undefined,
        textMatches(textScore),
      ),
    )
    .orderBy(asc(catalogTranslations.title), asc(catalogRecords.id));

  const { seasons } = await rowsFor(
    db,
    rows.map((r) => r.id),
  );
  const md = monthDayOf(seasonDate(origin, now));
  return rows
    .filter((r) => inSeason(byRecord(seasons, r.id), md))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      mode: r.mode as TransportMode,
      title: r.title,
      description: r.body,
      links: r.links,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      staleness: stalenessFor({ ...r, endsAt: null }, now),
      sources: sourcesOf(r.fieldSources),
    }));
}

/** Adds 1 to each record's recommendation count for the day. */
export async function recordRecommendations(
  db: Executor,
  recordIds: string[],
  day: CivilDate,
): Promise<void> {
  if (recordIds.length === 0) return;
  await db
    .insert(catalogRecommendations)
    .values(recordIds.map((recordId) => ({ recordId, day, count: 1 })))
    .onConflictDoUpdate({
      target: [catalogRecommendations.recordId, catalogRecommendations.day],
      set: { count: sql`${catalogRecommendations.count} + 1` },
    });
}

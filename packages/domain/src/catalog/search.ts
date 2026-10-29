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
  type PlaceImageRow,
  placeImages,
} from '../db/schema/catalog';
import { catalogSearchTexts, hostPlaceSearchTexts, type SearchTexts } from '../embeddings/store';
import type { Embedder } from '../embeddings/voyage';
import {
  getHostAddedPlace,
  hostAddedCandidates,
  hostPicksFor,
  toHostAddedSummary,
  visiblePickIds,
} from '../host-picks/guest';
import { offerIdsByPlace } from '../offers/guest';
import type { GuestLanguage } from '../property/vocabulary';
import { type CivilDate, toLocalDateTime } from '../time';
import { inSeason, monthDayOf, type OpenState, openStateAt } from './calendar';
import { type AboutMeFit, rankPlaces } from './ranking';
import { matcherFor, type Relevance, rankByRelevance, relevanceOf } from './relevance';
import { stalenessOf } from './staleness';
import {
  kmOf,
  latLngOf,
  loadOrigin,
  type Origin,
  originGeog,
  seasonDate,
  summaryOf,
  todayIn,
} from './summary';
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
  /** This property's host picked the place; its note in the guest's language. Null otherwise. */
  hostPick: { note: string | null } | null;
  /** A place the host added that is not in the catalog: unverified, not saveable. */
  hostAdded: boolean;
}

export interface PlaceQuery {
  query?: string;
  /** What the guest does not want; matching places rank last, they are not removed. Ignored without `query`. */
  avoid?: string;
  category?: PlaceCategory | 'day_trip';
  maxDistanceKm?: number;
  date?: CivilDate;
  /** 'HH:MM' local time on `date`. */
  openAt?: string;
  limit?: number;
  /** True: only records the admin marked good on a rainy day (daily tips, search_places). */
  rainyDay?: boolean;
  /**
   * False: do not count a recommendation. Daily tips search this way, since their cron recomputes
   * the same search every 15 minutes. Default true.
   */
  countRecommendation?: boolean;
  /** False: leave host-added places out (daily tips: they cannot be planned). Default true. */
  includeHostAdded?: boolean;
}

export interface PlaceSearch {
  date: CivilDate;
  openAt: string | null;
  results: PlaceSummary[];
  /** Null without a query; false when nothing matched it and these are the category's places instead. */
  matchesQuery: boolean | null;
  /** Matched the query and every other filter, but out of season on `date`. */
  outOfSeason: { id: string; title: string; seasons: { from: string; to: string }[] }[];
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
  /** Street address, when the admin gave one; the venue name often says enough. */
  address: string | null;
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

const distanceOf = (o: Origin) => {
  const g = originGeog(o);
  return g
    ? sql<number | null>`ST_Distance(${catalogRecords.location}::geography, ${g})`
    : sql<number | null>`null::float8`;
};

/** A guest's words as search scores them (catalog/relevance.ts). */
interface Wish {
  query: string;
  avoid: string | null;
  queryVector: number[] | null;
  avoidVector: number[] | null;
}

/**
 * The trimmed words with their vectors; null without words. One embedder call per search; when
 * there is no embedder or it fails, the vectors are null and search matches words only.
 */
async function wishOf(
  embedder: Embedder | null,
  query: string | undefined,
  avoid?: string,
): Promise<Wish | null> {
  const q = query?.trim();
  if (!q) return null;
  const a = avoid?.trim() || null;
  const wish: Wish = { query: q, avoid: a, queryVector: null, avoidVector: null };
  if (!embedder) return wish;
  try {
    const { vectors } = await embedder.embed(a ? [q, a] : [q], 'query');
    return {
      ...wish,
      queryVector: vectors[0] ?? null,
      avoidVector: a ? (vectors[1] ?? null) : null,
    };
  } catch {
    return wish;
  }
}

const NO_TEXTS: SearchTexts = { titles: [], texts: [], vectors: [] };

/** How well a record's published texts (all languages) answer the wish. */
const relevanceIn = (wish: Wish, texts: SearchTexts | undefined): Relevance =>
  relevanceOf({ ...wish, ...(texts ?? NO_TEXTS) });

/** The rows that match the words, in their order; all of them without words. */
async function matchingRows<T extends { id: string }>(
  db: Executor,
  rows: T[],
  embedder: Embedder | null,
  query: string | undefined,
): Promise<T[]> {
  const wish = await wishOf(embedder, query);
  if (!wish) return rows;
  const texts = await catalogSearchTexts(
    db,
    rows.map((r) => r.id),
    embedder?.model ?? '',
  );
  return rows.filter((r) => relevanceIn(wish, texts.get(r.id)).matches);
}

const mmdd = (m: number, d: number) =>
  `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Season rows as 'MM-DD' ranges. */
const seasonRangesOf = (seasons: CatalogSeasonRow[]) =>
  seasons.map((s) => ({ from: mmdd(s.fromMonth, s.fromDay), to: mmdd(s.toMonth, s.toDay) }));

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
 * or check-in before arrival), ranked best first, with this property's host-added places among
 * them (40). With words, only the places that match them, most relevant first (61); when none
 * match but a category was asked, that category's places with `matchesQuery: false`. Matches
 * dropped only for the season come back in `outOfSeason`. Counts a recommendation for every
 * catalog result. Null when the token's Stay, unit and property do not belong together.
 */
export async function searchPlaces(
  db: Db,
  scope: CatalogScope,
  q: PlaceQuery,
  now: Date,
  embedder: Embedder | null,
): Promise<PlaceSearch | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
  const date = seasonDate(origin, now, q.date);
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
  if (q.rainyDay) conditions.push(eq(catalogRecords.rainyDay, true));

  const rows = await db
    .select(placeColumns(origin))
    .from(catalogRecords)
    .innerJoin(catalogTranslations, translationJoin(scope))
    .where(and(...conditions));

  const { seasons, hours, images } = await rowsFor(
    db,
    rows.map((r) => r.id),
  );
  const md = monthDayOf(date);
  const inSeasonRows = rows.filter((r) => inSeason(byRecord(seasons, r.id), md));
  const seasonDropped = rows.filter((r) => !inSeasonRows.includes(r));
  const keptIds = inSeasonRows.map((r) => r.id);

  const wish = await wishOf(embedder, q.query, q.avoid);
  const model = embedder?.model ?? '';
  const texts = wish
    ? await catalogSearchTexts(
        db,
        rows.map((r) => r.id),
        model,
      )
    : new Map<string, SearchTexts>();
  // Without words every place matches and keeps its usual order.
  const relevanceFor = (t: SearchTexts | undefined): Relevance =>
    wish ? relevanceIn(wish, t) : { score: 0, matches: true, order: 0, semantic: false };

  const offerIds = await offerIdsByPlace(
    db,
    { destinationId: scope.destinationId, propertyId: scope.propertyId, language: scope.language },
    keptIds,
  );
  const picks = await hostPicksFor(db, scope, keptIds);
  const candidates = inSeasonRows.flatMap((r) => {
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
      hostPick: picks.get(r.id) ?? null,
      hostAdded: false,
    };
    const relevance = relevanceFor(texts.get(r.id));
    return [
      {
        summary,
        id: r.id,
        category: base.category,
        textScore: null,
        staleness: base.staleness.status,
        distanceM: r.distanceM === null ? null : Number(r.distanceM),
        // Only candidates that passed every filter above get here: the boost is among results that fit.
        bookable: bookableHere.length > 0,
        rel: relevance,
        relevance: relevance.order,
      },
    ];
  });

  // Host-added places have no rainy-day flag, and daily tips leave them out (they cannot be planned).
  const addedRows =
    q.rainyDay || q.includeHostAdded === false
      ? []
      : await hostAddedCandidates(db, scope, origin, q);
  const addedTexts = wish
    ? await hostPlaceSearchTexts(
        db,
        addedRows.map((r) => r.id),
        model,
      )
    : new Map<string, SearchTexts>();
  const added = addedRows.map((r) => {
    const relevance = relevanceFor(addedTexts.get(r.id));
    return {
      summary: toHostAddedSummary(r, q.openAt !== undefined),
      id: r.id,
      category: r.placeCategory as PlaceCategory,
      textScore: null,
      staleness: 'never_verified' as const,
      distanceM: r.distanceM === null ? null : Number(r.distanceM),
      bookable: false,
      rel: relevance,
      relevance: relevance.order,
    };
  });

  // The same rules for both: no boost for a host's pick or a host-added place.
  const all = [...candidates, ...added];
  const droppedRows = seasonDropped.map((r) => ({ r, relevance: relevanceFor(texts.get(r.id)) }));
  const matches = matcherFor([...all.map((c) => c.rel), ...droppedRows.map((d) => d.relevance)]);
  const matched = all.filter((c) => matches(c.rel));
  const matchesQuery = wish ? matched.length > 0 : null;
  const ranked = !wish
    ? rankPlaces(all, scope.aboutMe)
    : matchesQuery
      ? rankByRelevance(matched, scope.aboutMe)
      : q.category
        ? rankPlaces(all, scope.aboutMe)
        : [];
  const results = ranked.slice(0, q.limit ?? 5).map((c) => c.summary);

  // Host-added places have no seasons, so they never land here.
  const dropped = droppedRows.flatMap(({ r, relevance }) => {
    if (!matches(relevance)) return [];
    const base = placeBaseOf(r, now);
    return [
      {
        entry: { id: r.id, title: r.title, seasons: seasonRangesOf(byRecord(seasons, r.id)) },
        id: r.id,
        category: base.category,
        textScore: null,
        staleness: base.staleness.status,
        distanceM: r.distanceM === null ? null : Number(r.distanceM),
        relevance: relevance.order,
      },
    ];
  });
  const outOfSeason = (
    wish ? rankByRelevance(dropped, scope.aboutMe) : rankPlaces(dropped, scope.aboutMe)
  )
    .slice(0, q.limit ?? 5)
    .map((c) => c.entry);

  if (q.countRecommendation !== false) {
    await recordRecommendations(
      db,
      results.filter((r) => !r.hostAdded).map((r) => r.id),
      todayIn(now, origin.zone),
    );
  }
  return { date, openAt: q.openAt ?? null, results, matchesQuery, outOfSeason };
}

/** One place or day trip, or a host-added place, in full; null when it is not visible to this guest. */
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
  if (!r) return getHostAddedPlace(db, scope, origin, id);
  const { seasons, hours, images } = await rowsFor(db, [r.id]);
  const picks = await hostPicksFor(db, scope, [r.id]);
  return {
    ...placeBaseOf(r, now),
    description: r.body,
    image: images[0] ? imageOf(images[0]) : null,
    images: images.map(imageOf),
    seasons: seasonRangesOf(seasons),
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
    hostPick: picks.get(r.id) ?? null,
    hostAdded: false,
  };
}

/**
 * The places this property's host recommends (40): picks of visible records and visible
 * host-added places, in the order the host added them. Seasons and hours do not filter them;
 * `category` keeps one kind (61). Null when the token's Stay, unit and property do not belong
 * together.
 */
export async function listHostPicks(
  db: Db,
  scope: CatalogScope,
  now: Date,
  opts: { category?: PlaceCategory | 'day_trip' } = {},
): Promise<PlaceSummary[] | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
  const pickIds = await visiblePickIds(db, scope);
  const ids = pickIds.map((p) => p.recordId);
  const rows =
    ids.length === 0
      ? []
      : await db
          .select(placeColumns(origin))
          .from(catalogRecords)
          .innerJoin(catalogTranslations, translationJoin(scope))
          .where(and(visibleIn(scope), inArray(catalogRecords.id, ids)));
  const { images } = await rowsFor(db, ids);
  const offerIds = await offerIdsByPlace(
    db,
    { destinationId: scope.destinationId, propertyId: scope.propertyId, language: scope.language },
    ids,
  );
  const notes = await hostPicksFor(db, scope, ids);
  const picked = pickIds.flatMap(({ recordId, createdAt }) => {
    const r = rows.find((row) => row.id === recordId);
    if (!r) return [];
    const base = placeBaseOf(r, now);
    if (opts.category && base.category !== opts.category) return [];
    const image = images.find((i) => i.recordId === r.id);
    const summary: PlaceSummary = {
      ...base,
      summary: summaryOf(r.body),
      image: image ? imageOf(image) : null,
      open: null,
      offerIds: offerIds.get(r.id) ?? [],
      hostPick: notes.get(r.id) ?? { note: null },
      hostAdded: false,
    };
    return [{ summary, createdAt, id: r.id }];
  });
  const added = (await hostAddedCandidates(db, scope, origin, { category: opts.category })).map(
    (r) => ({
      summary: toHostAddedSummary(r, false),
      createdAt: r.createdAt,
      id: r.id,
    }),
  );
  return [...picked, ...added]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((p) => p.summary);
}

/**
 * Events overlapping the Stay ± 3 days that have not ended, soonest first. `from`/`to` narrow
 * that window and never widen it. `interests` keeps events tagged with any of them (daily tips);
 * an empty list matches no event.
 */
export async function searchEvents(
  db: Db,
  scope: CatalogScope,
  q: { query?: string; from?: CivilDate; to?: CivilDate; interests?: readonly string[] },
  now: Date,
  embedder: Embedder | null,
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
  if (start >= end || q.interests?.length === 0) return { window, results: [] };

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
      address: catalogRecords.address,
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
        q.interests
          ? sql`${catalogRecords.interests} && ${sql.param([...q.interests])}::text[]`
          : undefined,
      ),
    )
    .orderBy(asc(catalogRecords.startsAt), asc(catalogRecords.id));
  const matching = await matchingRows(db, rows, embedder, q.query);

  return {
    window,
    results: matching.slice(0, 10).map((r) => {
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
        address: r.address,
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
  embedder: Embedder | null,
): Promise<TransportNote[] | null> {
  const origin = await loadOrigin(db, scope);
  if (!origin) return null;
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
      ),
    )
    .orderBy(asc(catalogTranslations.title), asc(catalogRecords.id));
  const matching = await matchingRows(db, rows, embedder, q.query);

  const { seasons } = await rowsFor(
    db,
    matching.map((r) => r.id),
  );
  const md = monthDayOf(seasonDate(origin, now));
  return matching
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

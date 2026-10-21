import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecommendations, catalogRecords, destinations } from '../db/schema/catalog';
import {
  createTestDatabase,
  noopQueue,
  publishCatalog,
  type SeededGuestUnit,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import {
  type CatalogScope,
  getPlace,
  listTransportNotes,
  searchEvents,
  searchPlaces,
} from './search';
import { seedTrogir } from './seed/trogir';
import { createCatalogRecord } from './store';

const WINTER = new Date('2027-01-15T08:00:00Z');
const SUMMER = new Date('2027-07-10T08:00:00Z');
const DAY_MS = 86_400_000;

let testDb: TestDatabase;
let trogirId: string;
let winterGuest: SeededGuestUnit;
let summerGuest: SeededGuestUnit;
let lovrijenacId: string;
let hiddenCoveId: string;
const idOf: Record<string, string> = {};

const scopeOf = (g: SeededGuestUnit, over: Partial<CatalogScope> = {}): CatalogScope => ({
  destinationId: trogirId,
  propertyId: g.propertyId,
  stayId: g.stayId,
  language: 'de',
  aboutMe: null,
  ...over,
});
const winter = () => scopeOf(winterGuest);
const summer = () => scopeOf(summerGuest);
const titles = (r: { results: { title: string }[] } | null) =>
  (r?.results ?? []).map((p) => p.title.replace(/^\[de\] /, ''));

beforeAll(async () => {
  testDb = await createTestDatabase();
  const db = testDb.db;
  ({ destinationId: trogirId } = await seedTrogir(db, noopQueue, WINTER));
  const hidden = await createCatalogRecord(
    db,
    noopQueue,
    {
      destinationId: trogirId,
      kind: 'place',
      placeCategory: 'beach',
      title: 'Hidden cove',
      description: 'A secret beach.',
      location: { x: 16.252, y: 43.517 },
    },
    WINTER,
  );
  hiddenCoveId = hidden.id;
  await publishCatalog(db, trogirId);
  // Published by publishCatalog above; reset so it stays unpublished.
  await db
    .update(catalogRecords)
    .set({ publishedRevision: null, translationStatus: 'pending' })
    .where(eq(catalogRecords.id, hiddenCoveId));

  const [dubrovnik] = await db
    .insert(destinations)
    .values({ name: 'Dubrovnik', centre: { x: 18.0944, y: 42.6507 }, radiusM: 15_000 })
    .returning();
  if (!dubrovnik) throw new Error('no destination');
  const lovrijenac = await createCatalogRecord(
    db,
    noopQueue,
    {
      destinationId: dubrovnik.id,
      kind: 'place',
      placeCategory: 'sight',
      title: 'Lovrijenac fortress',
      description: 'A fortress outside the city walls.',
      location: { x: 18.1043, y: 42.6406 },
    },
    WINTER,
  );
  lovrijenacId = lovrijenac.id;
  await publishCatalog(db, dubrovnik.id);

  for (const r of await db.select().from(catalogRecords)) idOf[r.title] = r.id;
  winterGuest = await seedGuestUnit(db, { now: WINTER });
  summerGuest = await seedGuestUnit(db, { now: SUMMER });
});

afterAll(async () => {
  await testDb?.drop();
});

describe('searchPlaces', () => {
  it('filters by distance from the property and sorts equal results by distance', async () => {
    const near = await searchPlaces(testDb.db, summer(), { maxDistanceKm: 1 }, SUMMER);
    expect(titles(near).sort()).toEqual(['Cathedral of St Lawrence', 'Kamerlengo Fortress']);

    const all = await searchPlaces(testDb.db, summer(), { limit: 10 }, SUMMER);
    expect(titles(all)).toEqual(
      expect.arrayContaining(['Copacabana beach', 'Pantan nature reserve']),
    );
    const places = (all?.results ?? []).filter((p) => p.kind === 'place');
    const km = places.map((p) => p.distanceKm ?? Number.POSITIVE_INFINITY);
    expect(km).toEqual([...km].sort((a, b) => a - b));
  });

  it('filters by season on the day', async () => {
    const s = titles(await searchPlaces(testDb.db, summer(), { limit: 10 }, SUMMER));
    expect(s).toEqual(
      expect.arrayContaining(['Copacabana beach', 'Kamerlengo Fortress', 'Krka National Park']),
    );
    const w = titles(await searchPlaces(testDb.db, winter(), { limit: 10 }, WINTER));
    expect(w).not.toContain('Copacabana beach');
    expect(w).not.toContain('Kamerlengo Fortress');
    expect(w).not.toContain('Krka National Park');
    expect(w).toEqual(
      expect.arrayContaining(['Cathedral of St Lawrence', 'Pantan nature reserve']),
    );
  });

  it('checks the season on an asked date', async () => {
    const r = await searchPlaces(testDb.db, winter(), { date: '2027-07-12', limit: 10 }, WINTER);
    expect(r?.date).toBe('2027-07-12');
    expect(titles(r)).toContain('Copacabana beach');
  });

  it('drops places known to be closed at a time and keeps unknown hours', async () => {
    const ten = await searchPlaces(testDb.db, summer(), { openAt: '10:00', limit: 10 }, SUMMER);
    const at10 = Object.fromEntries((ten?.results ?? []).map((p) => [p.id, p.open]));
    expect(at10[idOf['Kamerlengo Fortress'] as string]).toBe('open');
    expect(at10[idOf['Cathedral of St Lawrence'] as string]).toBe('unknown');

    const late = titles(
      await searchPlaces(testDb.db, summer(), { openAt: '22:00', limit: 10 }, SUMMER),
    );
    expect(late).not.toContain('Kamerlengo Fortress');
    expect(late).toContain('Cathedral of St Lawrence');
  });

  it('filters by category and returns day trips with travel time', async () => {
    const beach = await searchPlaces(testDb.db, summer(), { category: 'beach' }, SUMMER);
    expect(titles(beach)).toEqual(['Copacabana beach']);
    const trips = await searchPlaces(testDb.db, summer(), { category: 'day_trip' }, SUMMER);
    expect(titles(trips)).toEqual(['Krka National Park']);
    expect(trips?.results[0]?.travelMinutes).toBe(60);
    expect(trips?.results[0]?.category).toBe('day_trip');
  });

  it('matches words by trigram similarity', async () => {
    const fortress = await searchPlaces(testDb.db, summer(), { query: 'fortress' }, SUMMER);
    expect(titles(fortress)[0]).toBe('Kamerlengo Fortress');
    expect(titles(await searchPlaces(testDb.db, summer(), { query: 'xyzzy' }, SUMMER))).toEqual([]);
    expect(titles(await searchPlaces(testDb.db, summer(), { query: 'wetland' }, SUMMER))).toEqual([
      'Pantan nature reserve',
    ]);
  });

  it('answers in the guest language', async () => {
    const r = await searchPlaces(testDb.db, summer(), { category: 'sight', limit: 10 }, SUMMER);
    for (const p of r?.results ?? []) expect(p.title.startsWith('[de] ')).toBe(true);
    const kamerlengo = r?.results.find((p) => p.id === idOf['Kamerlengo Fortress']);
    expect(kamerlengo?.summary).toBe(
      '[de] A 15th-century Venetian fortress at the western tip of the old town. Its walls and tower look out over the channel and the Čiovo bridge.',
    );
  });

  it('never returns another destination or an unpublished record', async () => {
    for (const q of [{}, { query: 'fortress' }, { category: 'beach' as const }]) {
      for (const [scope, now] of [
        [summer(), SUMMER],
        [winter(), WINTER],
      ] as const) {
        const ids = (await searchPlaces(testDb.db, scope, { ...q, limit: 10 }, now))?.results.map(
          (p) => p.id,
        );
        expect(ids).not.toContain(lovrijenacId);
        expect(ids).not.toContain(hiddenCoveId);
      }
    }
    expect(await getPlace(testDb.db, summer(), lovrijenacId, SUMMER)).toBeNull();
    expect(await getPlace(testDb.db, summer(), hiddenCoveId, SUMMER)).toBeNull();
  });

  it('returns null when the Stay does not belong to the property', async () => {
    const scope = scopeOf(summerGuest, { propertyId: winterGuest.propertyId });
    expect(await searchPlaces(testDb.db, scope, {}, SUMMER)).toBeNull();
  });
});

describe('getPlace', () => {
  it('gives the full record and refuses other kinds', async () => {
    expect(
      await getPlace(testDb.db, summer(), idOf['Trogir Summer of Culture'] as string, SUMMER),
    ).toBeNull();
    const p = await getPlace(testDb.db, summer(), idOf['Kamerlengo Fortress'] as string, SUMMER);
    expect(p?.seasons).toEqual([{ from: '04-01', to: '10-31' }]);
    expect(p?.openingHours).toHaveLength(7);
    expect(p?.openingHours[0]).toMatchObject({ opens: '09:00', closes: '21:00' });
    expect(p?.images).toHaveLength(1);
    expect(p?.images[0]?.attribution).toBe('Krzysztof Bergier');
    expect(p?.sources.map((s) => s.url)).toContain('https://visittrogir.hr/');
    expect(p?.inSeasonToday).toBe(true);
    expect(p?.description.startsWith('[de] ')).toBe(true);
  });
});

describe('staleness', () => {
  it('carries verifiedAt and the staleness status of each result', async () => {
    const all = await searchPlaces(testDb.db, summer(), { limit: 10 }, SUMMER);
    for (const p of all?.results ?? []) {
      expect(p.verifiedAt).toBe(WINTER.toISOString());
      expect(p.staleness.status).toBe('fresh');
    }
    const copacabana = idOf['Copacabana beach'] as string;
    const setVerified = (verifiedAt: Date | null) =>
      testDb.db.update(catalogRecords).set({ verifiedAt }).where(eq(catalogRecords.id, copacabana));
    const statusNow = async () =>
      (await searchPlaces(testDb.db, summer(), { category: 'beach' }, SUMMER))?.results[0]
        ?.staleness.status;

    await setVerified(new Date(SUMMER.getTime() - 400 * DAY_MS));
    expect(await statusNow()).toBe('stale');
    await setVerified(null);
    expect(await statusNow()).toBe('never_verified');
    await setVerified(WINTER);
  });
});

describe('searchEvents', () => {
  it('finds events overlapping the Stay in local time, and none in winter', async () => {
    const s = await searchEvents(testDb.db, summer(), {}, SUMMER);
    expect(s?.results.map((e) => e.title)).toEqual(['[de] Trogir Summer of Culture']);
    expect(s?.results[0]?.startsAt).toBe('2027-07-01T20:00');
    expect(s?.window).toEqual({ from: '2027-07-09', to: '2027-07-18' });
    expect((await searchEvents(testDb.db, winter(), {}, WINTER))?.results).toEqual([]);
  });

  it('never widens the window with from and to', async () => {
    const wide = await searchEvents(
      testDb.db,
      winter(),
      { from: '2027-06-01', to: '2027-09-30' },
      WINTER,
    );
    expect(wide?.results).toEqual([]);
    const reversed = await searchEvents(
      testDb.db,
      summer(),
      { from: '2027-07-15', to: '2027-07-12' },
      SUMMER,
    );
    expect(reversed?.results).toEqual([]);
  });
});

describe('listTransportNotes', () => {
  it('returns notes with their links as stored', async () => {
    const bus = await listTransportNotes(testDb.db, summer(), { mode: 'bus' }, SUMMER);
    expect(bus).toHaveLength(1);
    expect(bus?.[0]?.mode).toBe('bus');
    expect(bus?.[0]?.links).toEqual([
      { label: 'Promet Split timetables', url: 'https://www.promet-split.hr/' },
    ]);
    expect(await listTransportNotes(testDb.db, summer(), { mode: 'ferry' }, SUMMER)).toEqual([]);
  });
});

describe('recommendation counter', () => {
  it('counts each search result once per search, per destination day, and not getPlace', async () => {
    await testDb.db.delete(catalogRecommendations);
    const counts = async () =>
      (await testDb.db.select().from(catalogRecommendations)).map((r) => ({
        id: r.recordId,
        day: r.day,
        count: r.count,
      }));

    const r = await searchPlaces(testDb.db, summer(), { category: 'sight' }, SUMMER);
    const ids = (r?.results ?? []).map((p) => p.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    const once = await counts();
    expect(once.map((c) => c.id).sort()).toEqual(ids);
    for (const c of once) expect(c).toMatchObject({ day: '2027-07-10', count: 1 });

    await searchPlaces(testDb.db, summer(), { category: 'sight' }, SUMMER);
    for (const c of await counts()) expect(c.count).toBe(2);

    await getPlace(testDb.db, summer(), ids[0] as string, SUMMER);
    for (const c of await counts()) expect(c.count).toBe(2);
  });
});

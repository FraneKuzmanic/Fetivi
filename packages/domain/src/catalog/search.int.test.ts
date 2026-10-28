import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecommendations, catalogRecords, destinations } from '../db/schema/catalog';
import {
  createTestDatabase,
  noopQueue,
  publishCatalog,
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
  TROGIR,
} from '../testing';
import { fromLocalDateTime } from '../time';
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
  await createCatalogRecord(
    db,
    noopQueue,
    {
      destinationId: trogirId,
      kind: 'event',
      title: 'Morning klapa concert',
      description: 'Klapa singing on the waterfront.',
      startsAt: fromLocalDateTime('2027-07-09T09:00', 'Europe/Zagreb'),
      endsAt: fromLocalDateTime('2027-07-09T11:00', 'Europe/Zagreb'),
    },
    WINTER,
  );
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

  it('checks the season on check-in day before arrival', async () => {
    // The summer guest checks in two days after SUMMER.
    expect((await searchPlaces(testDb.db, summer(), {}, SUMMER))?.date).toBe('2027-07-12');
  });

  it('never matches words from an unpublished edit', async () => {
    const id = idOf['Copacabana beach'] as string;
    const [before] = await testDb.db.select().from(catalogRecords).where(eq(catalogRecords.id, id));
    if (!before) throw new Error('no record');
    await testDb.db
      .update(catalogRecords)
      .set({ title: 'Xylophone grotto', description: 'Xylophone grotto.', revision: 2 })
      .where(eq(catalogRecords.id, id));
    try {
      const r = await searchPlaces(testDb.db, summer(), { query: 'xylophone' }, SUMMER);
      expect(r?.results).toEqual([]);
      const beach = await searchPlaces(testDb.db, summer(), { category: 'beach' }, SUMMER);
      expect(titles(beach)).toEqual(['Copacabana beach']);
    } finally {
      await testDb.db
        .update(catalogRecords)
        .set({ title: before.title, description: before.description, revision: before.revision })
        .where(eq(catalogRecords.id, id));
    }
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

  it('drops events that have already ended', async () => {
    const early = new Date('2027-07-09T06:00:00Z');
    const before = await searchEvents(testDb.db, summer(), {}, early);
    expect(before?.results.map((e) => e.title)).toEqual([
      '[de] Trogir Summer of Culture',
      '[de] Morning klapa concert',
    ]);
    const after = await searchEvents(testDb.db, summer(), {}, SUMMER);
    expect(after?.results.map((e) => e.title)).not.toContain('[de] Morning klapa concert');
  });

  it('gives an event its address, location and distance when it has them, nulls when not', async () => {
    const festival = idOf['Trogir Summer of Culture'] as string;
    await testDb.db
      .update(catalogRecords)
      .set({ address: 'Obala bana Berislavića bb' })
      .where(eq(catalogRecords.id, festival));
    const early = new Date('2027-07-09T06:00:00Z');
    const [located, bare] = (await searchEvents(testDb.db, summer(), {}, early))?.results ?? [];
    expect(located).toMatchObject({
      address: 'Obala bana Berislavića bb',
      location: { lat: 43.5161, lng: 16.2475 },
    });
    expect(located?.distanceKm).toEqual(expect.any(Number));
    expect(bare).toMatchObject({ address: null, location: null, distanceKm: null });
    await testDb.db
      .update(catalogRecords)
      .set({ address: null })
      .where(eq(catalogRecords.id, festival));
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

describe('daily-tip seams', () => {
  it('keeps only rainy-day places when asked', async () => {
    const r = await searchPlaces(testDb.db, summer(), { rainyDay: true, limit: 10 }, SUMMER);
    expect(titles(r)).toEqual(['Cathedral of St Lawrence']);
  });

  it('keeps events tagged with an interest, and none for an empty list', async () => {
    const sights = await searchEvents(
      testDb.db,
      summer(),
      { interests: ['food', 'sights'] },
      SUMMER,
    );
    expect(sights?.results.map((e) => e.title)).toEqual(['[de] Trogir Summer of Culture']);
    const beaches = await searchEvents(testDb.db, summer(), { interests: ['beaches'] }, SUMMER);
    expect(beaches?.results).toEqual([]);
    const none = await searchEvents(testDb.db, summer(), { interests: [] }, SUMMER);
    expect(none?.results).toEqual([]);
  });

  it('counts no recommendation with countRecommendation: false', async () => {
    await testDb.db.delete(catalogRecommendations);
    const r = await searchPlaces(
      testDb.db,
      summer(),
      { category: 'sight', countRecommendation: false },
      SUMMER,
    );
    expect(r?.results.length).toBeGreaterThan(0);
    expect(await testDb.db.select().from(catalogRecommendations)).toEqual([]);
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

  it("counts on the destination's day, not the UTC day", async () => {
    await testDb.db.delete(catalogRecommendations);
    // 23:30 UTC on 10 July is 01:30 on 11 July in Zagreb.
    const lateUtc = new Date('2027-07-10T23:30:00Z');
    await searchPlaces(testDb.db, summer(), { category: 'sight' }, lateUtc);
    const days = (await testDb.db.select().from(catalogRecommendations)).map((r) => r.day);
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) expect(d).toBe('2027-07-11');
  });
});

describe('bookable boost', () => {
  let dest: string;
  const place = async (title: string, location = TROGIR) => {
    const [r] = await testDb.db
      .insert(catalogRecords)
      .values({
        destinationId: dest,
        kind: 'place',
        placeCategory: 'beach',
        title,
        description: 'A cove.',
        location,
      })
      .returning();
    if (!r) throw new Error('no place');
    return r.id;
  };
  const linkProvider = async (
    placeId: string,
    opts: { commissionBp?: number; destinationId?: string } = {},
  ) => {
    const provider = await seedProvider(testDb.db, { commissionBp: opts.commissionBp ?? 0 });
    const { offerId } = await seedOrderableOffer(testDb.db, {
      providerId: provider.id,
      destinationId: opts.destinationId ?? dest,
      availabilityMode: 'on_request',
      placeId,
    });
    await publishOffer(testDb.db, offerId);
    return offerId;
  };
  const search = () =>
    searchPlaces(testDb.db, scopeOf(summerGuest, { destinationId: dest }), { limit: 10 }, SUMMER);
  const order = async () => (await search())?.results.map((p) => p.id) ?? [];

  beforeAll(async () => {
    dest = await seedDestination(testDb.db);
  });

  it('puts the bookable one of two equal places first, with offerIds', async () => {
    const a = await place('Twin A');
    const b = await place('Twin B');
    await publishCatalog(testDb.db, dest);
    const [, second] = await order();
    const other = second === a ? b : a;
    const offerId = await linkProvider(second as string);
    const results = (await search())?.results ?? [];
    expect(results[0]?.id).toBe(second);
    expect(results[0]?.offerIds).toEqual([offerId]);
    expect(results.find((p) => p.id === other)?.offerIds).toEqual([]);
  });

  it('never lifts a clearly worse fit, and ignores other hosts and destinations', async () => {
    const near = await place('Near', TROGIR);
    const far = await place('Far', { x: TROGIR.x + 0.37, y: TROGIR.y });
    await publishCatalog(testDb.db, dest);
    await linkProvider(far);
    const ids = await order();
    expect(ids.indexOf(near)).toBeLessThan(ids.indexOf(far));

    const elsewhere = await seedDestination(testDb.db);
    const outsider = await place('Outsider', TROGIR);
    await publishCatalog(testDb.db, dest);
    await linkProvider(outsider, { destinationId: elsewhere });
    const neighbour = await seedGuestUnit(testDb.db, { now: SUMMER });
    const { offerId } = await seedOrderableOffer(testDb.db, {
      hostId: neighbour.hostId,
      availabilityMode: 'on_request',
      placeId: outsider,
    });
    await publishOffer(testDb.db, offerId);
    const results = (await search())?.results ?? [];
    expect(results.find((p) => p.id === outsider)?.offerIds).toEqual([]);
  });

  it('gives the same position for a high- and a zero-commission Offer', async () => {
    const solo = await seedDestination(testDb.db);
    dest = solo;
    const x = await place('Commission X');
    const y = await place('Commission Y');
    await publishCatalog(testDb.db, dest);
    const before = await order();
    await linkProvider(x, { commissionBp: 9000 });
    await linkProvider(y, { commissionBp: 0 });
    expect(await order()).toEqual(before);
    expect(before.sort()).toEqual([x, y].sort());
  });
});

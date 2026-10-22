import { catalogRecords } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  del,
  get,
  loginAs,
  PASSWORD,
  patch,
  post,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminCookie: string;
let hostId: string;
let trogirId: string;

const DAY = 86_400_000;
const LOC = { lat: 43.5161, lng: 16.2475 };

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  hostCookie = await loginAs(t, 'a@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  const hosts = await get(t.app, '/api/admin/hosts', adminCookie);
  hostId = hosts.json().hosts[0].id;
  const trogir = await post(
    t.app,
    '/api/admin/destinations',
    { name: 'Trogir', centre: { lat: 43.5169, lng: 16.2513 }, radiusKm: 15 },
    adminCookie,
  );
  trogirId = trogir.json().id;
});

afterAll(async () => {
  await t?.close();
});

const records = (destinationId = trogirId) => `/api/admin/destinations/${destinationId}/records`;
const recordUrl = (id: string) => `/api/admin/catalog/records/${id}`;
const placeBody = (extra: Record<string, unknown> = {}) => ({
  kind: 'place',
  title: 'Konoba Trs',
  description: 'Dalmatian food in a stone courtyard.',
  placeCategory: 'restaurant',
  location: LOC,
  ...extra,
});
const createPlace = async (extra: Record<string, unknown> = {}) => {
  const response = await post(t.app, records(), placeBody(extra), adminCookie);
  expect(response.statusCode).toBe(201);
  return response.json();
};
const eventBody = {
  kind: 'event',
  title: 'Summer of Culture',
  description: 'Concerts in the fortress.',
  startsAt: '2027-07-01T20:00',
  endsAt: '2027-08-31T23:00',
  venueName: 'Kamerlengo Fortress',
};

describe('access', () => {
  it('is admin-only', async () => {
    expect((await get(t.app, '/api/admin/destinations', hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, records(), placeBody(), hostCookie)).statusCode).toBe(403);
    expect((await get(t.app, '/api/admin/destinations')).statusCode).toBe(401);
  });

  it('refuses an admin who is acting as a host', async () => {
    await post(t.app, '/api/admin/act-as', { hostId }, adminCookie);
    const response = await get(t.app, '/api/admin/destinations', adminCookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'stop-acting-first' });
    await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
  });
});

describe('destinations', () => {
  it('creates, patches and lists a destination', async () => {
    const created = await get(t.app, `/api/admin/destinations/${trogirId}`, adminCookie);
    expect(created.json()).toMatchObject({
      name: 'Trogir',
      centre: { lat: 43.5169, lng: 16.2513 },
      radiusKm: 15,
      timezone: 'Europe/Zagreb',
    });
    const patched = await patch(
      t.app,
      `/api/admin/destinations/${trogirId}`,
      { radiusKm: 16 },
      adminCookie,
    );
    expect(patched.json().radiusKm).toBe(16);
    await patch(t.app, `/api/admin/destinations/${trogirId}`, { radiusKm: 15 }, adminCookie);
    const list = await get(t.app, '/api/admin/destinations', adminCookie);
    expect(list.json().destinations.map((d: { name: string }) => d.name)).toContain('Trogir');
  });

  it.each([
    ['a duplicate name', { name: 'Trogir', centre: LOC, radiusKm: 15 }],
    ['a radius under 1 km', { name: 'Small', centre: LOC, radiusKm: 0.5 }],
    ['a radius over 100 km', { name: 'Big', centre: LOC, radiusKm: 101 }],
  ])('refuses %s', async (_name, body) => {
    const response = await post(t.app, '/api/admin/destinations', body, adminCookie);
    expect(response.statusCode).toBe(400);
  });

  it.each([1, 100])('accepts a radius of exactly %i km', async (radiusKm) => {
    const url = `/api/admin/destinations/${trogirId}`;
    const patched = await patch(t.app, url, { radiusKm }, adminCookie);
    expect(patched.statusCode).toBe(200);
    expect(patched.json().radiusKm).toBe(radiusKm);
    await patch(t.app, url, { radiusKm: 15 }, adminCookie);
  });

  it('refuses to delete a destination with records, and deletes an empty one', async () => {
    const split = await post(
      t.app,
      '/api/admin/destinations',
      { name: 'Split', centre: { lat: 43.5081, lng: 16.4402 }, radiusKm: 1 },
      adminCookie,
    );
    expect(split.json().radiusKm).toBe(1);
    const splitId = split.json().id;
    const record = await post(t.app, records(splitId), placeBody(), adminCookie);
    const blocked = await del(t.app, `/api/admin/destinations/${splitId}`, adminCookie);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: 'destination-not-empty' });
    await del(t.app, recordUrl(record.json().id), adminCookie);
    expect((await del(t.app, `/api/admin/destinations/${splitId}`, adminCookie)).statusCode).toBe(
      204,
    );
  });
});

describe('records', () => {
  it('creates one record of each kind', async () => {
    const place = await createPlace({ phone: '+385 21 885 000', websiteUrl: 'https://trs.hr/' });
    expect(place).toMatchObject({
      kind: 'place',
      placeCategory: 'restaurant',
      location: LOC,
      phone: '+385 21 885 000',
      translation: { status: 'pending', revision: 1 },
      staleness: { status: 'never_verified' },
      images: [],
    });

    const event = await post(t.app, records(), eventBody, adminCookie);
    expect(event.statusCode).toBe(201);
    expect(event.json()).toMatchObject({
      startsAt: '2027-07-01T20:00',
      endsAt: '2027-08-31T23:00',
      venueName: 'Kamerlengo Fortress',
    });

    const note = await post(
      t.app,
      records(),
      {
        kind: 'transport_note',
        title: 'Bus 37',
        description: 'Split to Trogir.',
        transportMode: 'bus',
        links: [{ label: 'Timetable', url: 'https://www.promet-split.hr/' }],
      },
      adminCookie,
    );
    expect(note.statusCode).toBe(201);
    expect(note.json().links).toEqual([
      { label: 'Timetable', url: 'https://www.promet-split.hr/' },
    ]);

    const trip = await post(
      t.app,
      records(),
      {
        kind: 'day_trip',
        title: 'Krka',
        description: 'Waterfalls.',
        travelMinutes: 60,
        location: { lat: 43.8047, lng: 15.9644 },
        fieldSources: { travelMinutes: 'https://www.np-krka.hr/' },
      },
      adminCookie,
    );
    expect(trip.statusCode).toBe(201);
    expect(trip.json()).toMatchObject({
      travelMinutes: 60,
      fieldSources: { travelMinutes: 'https://www.np-krka.hr/' },
    });

    const list = await get(t.app, `${records()}?kind=event`, adminCookie);
    expect(list.json().records.map((r: { kind: string }) => r.kind)).toEqual(['event']);

    const destination = await get(t.app, `/api/admin/destinations/${trogirId}`, adminCookie);
    const all = await get(t.app, records(), adminCookie);
    expect(destination.json().recordCount).toBe(all.json().records.length);
    const listed = await get(t.app, '/api/admin/destinations', adminCookie);
    expect(
      listed.json().destinations.find((d: { id: string }) => d.id === trogirId).recordCount,
    ).toBe(all.json().records.length);
  });

  it.each([
    ['a place without a location', placeBody({ location: undefined })],
    ['an event ending before it starts', { ...eventBody, endsAt: '2027-06-01T20:00' }],
    ['an event time in the DST gap', { ...eventBody, startsAt: '2027-03-28T02:30' }],
    ['a server-owned field', placeBody({ verifiedAt: '2027-01-01T00:00:00Z' })],
    [
      'a source for a field the kind lacks',
      placeBody({ fieldSources: { venueName: 'https://x.hr/' } }),
    ],
    ['an http website', placeBody({ websiteUrl: 'http://trs.hr/' })],
    ['a title over 120 characters', placeBody({ title: 'x'.repeat(121) })],
  ])('refuses %s', async (_name, body) => {
    const response = await post(t.app, records(), body, adminCookie);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-input' });
  });

  it('keeps the ferry lines of a day trip, in table order, and refuses an unknown line', async () => {
    const tripBody = {
      kind: 'day_trip',
      title: 'Bol',
      description: 'Zlatni rat by catamaran.',
      travelMinutes: 90,
      ferryLines: ['9603', '635', '9603'],
    };
    const trip = await post(t.app, records(), tripBody, adminCookie);
    expect(trip.statusCode).toBe(201);
    expect(trip.json().ferryLines).toEqual(['635', '9603']);
    const read = await get(t.app, recordUrl(trip.json().id), adminCookie);
    expect(read.json().ferryLines).toEqual(['635', '9603']);

    const cleared = await patch(t.app, recordUrl(trip.json().id), { ferryLines: [] }, adminCookie);
    expect(cleared.json().ferryLines).toEqual([]);

    const unknown = await post(
      t.app,
      records(),
      { ...tripBody, ferryLines: ['2026'] },
      adminCookie,
    );
    expect(unknown.statusCode).toBe(400);
  });

  it('strips markup from the description', async () => {
    const place = await createPlace({ description: 'Good fish.<script>alert(1)</script>' });
    expect(place.description).not.toContain('<script>');
  });

  it('adds a revision only when the text changes', async () => {
    const place = await createPlace();
    const phoned = await patch(
      t.app,
      recordUrl(place.id),
      { phone: '+385 21 000 000' },
      adminCookie,
    );
    expect(phoned.json().translation.revision).toBe(1);
    const described = await patch(
      t.app,
      recordUrl(place.id),
      { description: 'Grilled fish.' },
      adminCookie,
    );
    expect(described.json().translation).toMatchObject({ revision: 2, status: 'pending' });
    const withKind = await patch(t.app, recordUrl(place.id), { kind: 'event' }, adminCookie);
    expect(withKind.statusCode).toBe(400);
  });

  it('refuses an event patch that ends before the stored start', async () => {
    const event = (await post(t.app, records(), eventBody, adminCookie)).json();
    const response = await patch(
      t.app,
      recordUrl(event.id),
      { endsAt: '2027-06-30T20:00' },
      adminCookie,
    );
    expect(response.statusCode).toBe(400);
  });
});

describe('seasons and opening hours', () => {
  it('stores seasons, including one that wraps the year', async () => {
    const place = await createPlace();
    const response = await put(
      t.app,
      `${recordUrl(place.id)}/seasons`,
      {
        seasons: [
          { from: '11-01', to: '03-31' },
          { from: '02-29', to: '04-01' },
        ],
      },
      adminCookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().seasons).toEqual([
      { from: '02-29', to: '04-01' },
      { from: '11-01', to: '03-31' },
    ]);
  });

  it.each(['02-30', '13-01'])('refuses the day %s', async (day) => {
    const place = await createPlace();
    const response = await put(
      t.app,
      `${recordUrl(place.id)}/seasons`,
      { seasons: [{ from: day, to: '12-31' }] },
      adminCookie,
    );
    expect(response.statusCode).toBe(400);
  });

  it('stores hours past midnight and refuses bad rows', async () => {
    const place = await createPlace();
    const hours = (row: Record<string, unknown>) =>
      put(
        t.app,
        `${recordUrl(place.id)}/opening-hours`,
        {
          hours: [
            { weekday: 5, opens: '20:00', closes: '02:00', validFrom: null, validTo: null, ...row },
          ],
        },
        adminCookie,
      );
    const ok = await hours({});
    expect(ok.json().openingHours).toEqual([
      { weekday: 5, opens: '20:00', closes: '02:00', validFrom: null, validTo: null },
    ]);
    expect((await hours({ closes: '20:00' })).statusCode).toBe(400);
    expect((await hours({ validFrom: '2027-09-01', validTo: '2027-06-01' })).statusCode).toBe(400);
  });

  it('refuses hours on an event', async () => {
    const event = (await post(t.app, records(), eventBody, adminCookie)).json();
    const response = await put(
      t.app,
      `${recordUrl(event.id)}/opening-hours`,
      { hours: [] },
      adminCookie,
    );
    expect(response.statusCode).toBe(400);
  });
});

describe('images', () => {
  const commons = {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/89/Fortress_Kamerlengo_14.jpg',
    source: 'wikimedia_commons',
    licence: 'CC BY-SA 4.0',
    attribution: 'Krzysztof Bergier',
    sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Fortress_Kamerlengo_14.jpg',
  };
  const putImages = async (id: string, images: unknown[]) =>
    put(t.app, `${recordUrl(id)}/images`, { images }, adminCookie);

  it('stores a Wikimedia image with all its fields', async () => {
    const place = await createPlace();
    const response = await putImages(place.id, [commons]);
    expect(response.statusCode).toBe(200);
    expect(response.json().images).toEqual([commons]);
  });

  it.each([
    ['a Wikimedia image without a licence', { ...commons, licence: '' }],
    [
      'a Wikimedia image off upload.wikimedia.org',
      { ...commons, url: 'https://example.com/a.jpg' },
    ],
    [
      'a Google-hosted image',
      {
        url: 'https://lh3.googleusercontent.com/p/abc',
        source: 'own_photo',
        licence: '',
        attribution: '',
        sourcePageUrl: '',
      },
    ],
    [
      'a venue image without an attribution',
      {
        url: 'https://trs.hr/a.jpg',
        source: 'venue_permission',
        licence: '',
        attribution: '',
        sourcePageUrl: '',
      },
    ],
  ])('refuses %s', async (_name, image) => {
    const place = await createPlace();
    expect((await putImages(place.id, [image])).statusCode).toBe(400);
  });

  it('refuses images on a transport note', async () => {
    const note = await post(
      t.app,
      records(),
      { kind: 'transport_note', title: 'Ferry', description: 'To Split.', transportMode: 'ferry' },
      adminCookie,
    );
    expect((await putImages(note.json().id, [])).statusCode).toBe(400);
  });
});

describe('verification', () => {
  it('stamps verified_at, then a restaurant goes stale after 90 days', async () => {
    const place = await createPlace();
    const verified = await post(t.app, `${recordUrl(place.id)}/verify`, undefined, adminCookie);
    expect(verified.json()).toMatchObject({
      verifiedAt: t.clock.now().toISOString(),
      verifiedByEmail: 'admin@example.test',
      staleness: { status: 'fresh' },
    });
    t.clock.advance(91 * DAY);
    // Sessions do not last 91 days.
    adminCookie = await loginAs(t, 'admin@example.test');
    const later = await get(t.app, recordUrl(place.id), adminCookie);
    expect(later.json().staleness.status).toBe('stale');
  });
});

describe('translations', () => {
  it('lists seven empty languages while pending, and retries only a failed record', async () => {
    const place = await createPlace();
    const view = await get(t.app, `${recordUrl(place.id)}/translations`, adminCookie);
    expect(view.json().languages).toHaveLength(7);
    expect(view.json().languages.every((l: { current: unknown }) => l.current === null)).toBe(true);

    const early = await post(
      t.app,
      `${recordUrl(place.id)}/translations/retry`,
      undefined,
      adminCookie,
    );
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'translation-not-failed' });

    await t.db
      .update(catalogRecords)
      .set({ translationStatus: 'failed', translationError: 'model-error' })
      .where(eq(catalogRecords.id, place.id));
    const retried = await post(
      t.app,
      `${recordUrl(place.id)}/translations/retry`,
      undefined,
      adminCookie,
    );
    expect(retried.statusCode).toBe(200);
    expect(retried.json().view.status).toBe('pending');
  });
});

describe('deletion', () => {
  it('deletes a record', async () => {
    const place = await createPlace();
    expect((await del(t.app, recordUrl(place.id), adminCookie)).statusCode).toBe(204);
    expect((await get(t.app, recordUrl(place.id), adminCookie)).statusCode).toBe(404);
  });
});

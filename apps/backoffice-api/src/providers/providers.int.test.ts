import { allotmentSlots, QUEUES } from '@fetivi/domain';
import { eq, sql } from 'drizzle-orm';
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
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminCookie: string;
let hostId: string;
let trogirId: string;
let splitId: string;
let trogirPlaceId: string;
let splitPlaceId: string;
let trogirEventId: string;
let providerId: string;

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

async function createDestination(name: string, centre: { lat: number; lng: number }) {
  const response = await post(
    t.app,
    '/api/admin/destinations',
    { name, centre, radiusKm: 15 },
    adminCookie,
  );
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

async function createRecord(destinationId: string, body: Record<string, unknown>) {
  const response = await post(
    t.app,
    `/api/admin/destinations/${destinationId}/records`,
    body,
    adminCookie,
  );
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

const place = (title: string, location: { lat: number; lng: number }) => ({
  kind: 'place',
  title,
  description: 'A place.',
  placeCategory: 'sight',
  location,
});

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  hostCookie = await loginAs(t, 'a@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  const hosts = await get(t.app, '/api/admin/hosts', adminCookie);
  hostId = hosts.json().hosts[0].id;
  trogirId = await createDestination('Trogir', { lat: 43.5169, lng: 16.2513 });
  splitId = await createDestination('Split', { lat: 43.5081, lng: 16.4402 });
  trogirPlaceId = await createRecord(trogirId, place('Kamerlengo', { lat: 43.5161, lng: 16.2475 }));
  splitPlaceId = await createRecord(splitId, place('Riva', { lat: 43.5075, lng: 16.4392 }));
  trogirEventId = await createRecord(trogirId, {
    kind: 'event',
    title: 'Concert',
    description: 'Music.',
    startsAt: '2027-07-01T20:00',
    endsAt: '2027-07-01T22:00',
  });
  const provider = await post(
    t.app,
    '/api/admin/providers',
    { name: 'Mare Trogir Boats', email: 'Bookings@Mare.example ', commissionBp: 1_500 },
    adminCookie,
  );
  expect(provider.statusCode).toBe(201);
  providerId = provider.json().id;
});

afterAll(async () => {
  await t?.close();
});

const offersUrl = (id = providerId) => `/api/admin/providers/${id}/offers`;
const offerUrl = (id: string) => `/api/admin/offers/${id}`;
const offerBody = (extra: Record<string, unknown> = {}) => ({
  destinationId: trogirId,
  title: 'Blue Lagoon boat trip',
  description: 'A day on the water.',
  cancellationPolicy: 'Free cancellation up to 24 hours before departure.',
  category: 'boat_trip',
  orderKind: 'booking',
  availabilityMode: 'allotment',
  paymentMode: 'direct',
  priceMinor: 4_500,
  ...extra,
});
const createOffer = async (extra: Record<string, unknown> = {}) => {
  const response = await post(t.app, offersUrl(), offerBody(extra), adminCookie);
  expect(response.statusCode).toBe(201);
  return response.json();
};

const jobsFor = async (offerId: string) => {
  const { rows } = await t.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateOffer} and data->>'offerId' = ${offerId}`,
  );
  return rows[0]?.n ?? 0;
};

describe('access', () => {
  it('is admin-only', async () => {
    expect((await get(t.app, '/api/admin/providers', hostCookie)).statusCode).toBe(403);
    expect((await post(t.app, offersUrl(), offerBody(), hostCookie)).statusCode).toBe(403);
    expect((await get(t.app, '/api/admin/providers')).statusCode).toBe(401);
  });

  it('refuses an admin who is acting as a host', async () => {
    await post(t.app, '/api/admin/act-as', { hostId }, adminCookie);
    const response = await get(t.app, '/api/admin/providers', adminCookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'stop-acting-first' });
    await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
  });
});

describe('providers', () => {
  it('creates, gets, patches and lists a Provider', async () => {
    const got = await get(t.app, `/api/admin/providers/${providerId}`, adminCookie);
    expect(got.json()).toMatchObject({
      name: 'Mare Trogir Boats',
      email: 'bookings@mare.example',
      commissionBp: 1_500,
      whatsappPhone: null,
      stripeConnected: false,
      active: true,
      offerCount: 0,
    });
    expect(got.json()).not.toHaveProperty('stripeAccountId');
    const patched = await patch(
      t.app,
      `/api/admin/providers/${providerId}`,
      { whatsappPhone: '+385 91 234 5678', taxNumber: 'HR12345678901', dealNotes: '<b>Net</b> 30' },
      adminCookie,
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      whatsappPhone: '+385 91 234 5678',
      taxNumber: 'HR12345678901',
      dealNotes: 'Net 30',
    });
    const list = await get(t.app, '/api/admin/providers', adminCookie);
    expect(list.json().providers.map((p: { name: string }) => p.name)).toContain(
      'Mare Trogir Boats',
    );
  });

  it.each([
    ['a duplicate name', { name: 'Mare Trogir Boats', email: 'x@example.test' }],
    ['a bad email', { name: 'Other', email: 'not-an-email' }],
    ['a commission over 100 %', { name: 'Other', email: 'x@example.test', commissionBp: 10_001 }],
    [
      'a Stripe account id',
      { name: 'Other', email: 'x@example.test', stripeAccountId: 'acct_123' },
    ],
  ])('refuses %s', async (_, body) => {
    const response = await post(t.app, '/api/admin/providers', body, adminCookie);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-input' });
  });

  it('deletes a Provider only without Offers', async () => {
    const other = await post(
      t.app,
      '/api/admin/providers',
      { name: 'Konoba Trs', email: 'trs@example.test' },
      adminCookie,
    );
    const otherId = other.json().id;
    const offer = await post(t.app, offersUrl(otherId), offerBody(), adminCookie);
    expect(offer.statusCode).toBe(201);
    const refused = await del(t.app, `/api/admin/providers/${otherId}`, adminCookie);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'provider-has-offers' });
    expect(
      (await get(t.app, `/api/admin/providers/${otherId}`, adminCookie)).json().offerCount,
    ).toBe(1);
    expect((await del(t.app, offerUrl(offer.json().id), adminCookie)).statusCode).toBe(204);
    expect((await del(t.app, `/api/admin/providers/${otherId}`, adminCookie)).statusCode).toBe(204);
    expect((await get(t.app, `/api/admin/providers/${otherId}`, adminCookie)).statusCode).toBe(404);
  });
});

describe('offers: validation', () => {
  it('creates an Offer with defaults', async () => {
    const offer = await createOffer();
    expect(offer).toMatchObject({
      provider: { id: providerId, name: 'Mare Trogir Boats' },
      destination: { id: trogirId, name: 'Trogir' },
      timezone: 'Europe/Zagreb',
      currency: 'EUR',
      priceUnit: 'person',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      responseWindowMinutes: 30,
      responseHoursFrom: '08:00',
      responseHoursTo: '21:00',
      contactFields: 'name',
      adapterKind: null,
      externalProductRef: null,
      place: null,
      active: true,
      translation: { status: 'pending', revision: 1, publishedRevision: null },
    });
  });

  it('keeps the response window under four days', async () => {
    const over = await post(
      t.app,
      offersUrl(),
      offerBody({ responseWindowMinutes: 5_760 }),
      adminCookie,
    );
    expect(over.statusCode).toBe(400);
    expect((await createOffer({ responseWindowMinutes: 5_759 })).responseWindowMinutes).toBe(5_759);
    const hours = await post(
      t.app,
      offersUrl(),
      offerBody({ responseHoursFrom: '21:00', responseHoursTo: '08:00' }),
      adminCookie,
    );
    expect(hours.statusCode).toBe(400);
  });

  it('requires an adapter and a reference for live mode', async () => {
    const bare = await post(
      t.app,
      offersUrl(),
      offerBody({ availabilityMode: 'live' }),
      adminCookie,
    );
    expect(bare.statusCode).toBe(400);
    const noRef = await post(
      t.app,
      offersUrl(),
      offerBody({ availabilityMode: 'live', adapterKind: 'bokun' }),
      adminCookie,
    );
    expect(noRef.statusCode).toBe(400);
    const live = await createOffer({
      availabilityMode: 'live',
      adapterKind: 'bokun',
      externalProductRef: 'P-123',
    });
    expect(live).toMatchObject({ adapterKind: 'bokun', externalProductRef: 'P-123' });
  });

  it('allows a missing price only for on-request requests', async () => {
    const booking = await post(t.app, offersUrl(), offerBody({ priceMinor: null }), adminCookie);
    expect(booking.statusCode).toBe(400);
    const request = await createOffer({
      orderKind: 'request',
      availabilityMode: 'on_request',
      priceMinor: null,
    });
    expect(request.priceMinor).toBeNull();
    const allotmentRequest = await post(
      t.app,
      offersUrl(),
      offerBody({ orderKind: 'request', priceMinor: null }),
      adminCookie,
    );
    expect(allotmentRequest.statusCode).toBe(400);
  });

  it('keeps Order kind and Category independent', async () => {
    const request = await createOffer({
      category: 'transfer',
      orderKind: 'request',
      availabilityMode: 'on_request',
      priceMinor: null,
    });
    const booking = await createOffer({ category: 'transfer', orderKind: 'booking' });
    expect([request.category, booking.category]).toEqual(['transfer', 'transfer']);
  });

  it('refuses a patch that breaks a row rule or changes the destination', async () => {
    const offer = await createOffer();
    const halfLive = await patch(
      t.app,
      offerUrl(offer.id),
      { availabilityMode: 'live' },
      adminCookie,
    );
    expect(halfLive.statusCode).toBe(400);
    expect(halfLive.json()).toEqual({ error: 'invalid-input' });
    const moved = await patch(t.app, offerUrl(offer.id), { destinationId: splitId }, adminCookie);
    expect(moved.statusCode).toBe(400);
    const switched = await patch(
      t.app,
      offerUrl(offer.id),
      {
        availabilityMode: 'live',
        adapterKind: 'bokun',
        externalProductRef: 'P-9',
        responseWindowMinutes: 30,
        responseHoursFrom: '08:00',
        responseHoursTo: '21:00',
      },
      adminCookie,
    );
    expect(switched.statusCode).toBe(200);
    const back = await patch(
      t.app,
      offerUrl(offer.id),
      { availabilityMode: 'on_request', adapterKind: null, externalProductRef: null },
      adminCookie,
    );
    expect(back.json()).toMatchObject({ availabilityMode: 'on_request', adapterKind: null });
  });
});

describe('offers: destination scoping', () => {
  it('links only a place in the Offer destination', async () => {
    const offer = await createOffer();
    const split = await patch(t.app, offerUrl(offer.id), { placeId: splitPlaceId }, adminCookie);
    expect(split.statusCode).toBe(400);
    const event = await patch(t.app, offerUrl(offer.id), { placeId: trogirEventId }, adminCookie);
    expect(event.statusCode).toBe(400);
    const linked = await patch(t.app, offerUrl(offer.id), { placeId: trogirPlaceId }, adminCookie);
    expect(linked.statusCode).toBe(200);
    expect(linked.json().place).toEqual({ id: trogirPlaceId, title: 'Kamerlengo' });
    const onCreate = await post(
      t.app,
      offersUrl(),
      offerBody({ placeId: splitPlaceId }),
      adminCookie,
    );
    expect(onCreate.statusCode).toBe(400);
  });

  it('refuses an unknown destination', async () => {
    const response = await post(
      t.app,
      offersUrl(),
      offerBody({ destinationId: '00000000-0000-4000-8000-000000000000' }),
      adminCookie,
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-input' });
  });

  it('drops the link when the place is deleted', async () => {
    const placeId = await createRecord(trogirId, place('Cathedral', { lat: 43.517, lng: 16.2513 }));
    const offer = await createOffer({ placeId });
    expect(offer.place.id).toBe(placeId);
    expect(
      (await del(t.app, `/api/admin/catalog/records/${placeId}`, adminCookie)).statusCode,
    ).toBe(204);
    const after = await get(t.app, offerUrl(offer.id), adminCookie);
    expect(after.json()).toMatchObject({ placeId: null, place: null });
    expect(after.json().translation.revision).toBe(1);
  });

  it('keeps a destination with Offers from being deleted', async () => {
    const empty = await createDestination('Seget', { lat: 43.5188, lng: 16.2186 });
    await createOffer({ destinationId: empty });
    const response = await del(t.app, `/api/admin/destinations/${empty}`, adminCookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'destination-not-empty' });
  });
});

describe('offers: translation', () => {
  it('enqueues on create and on a text change only', async () => {
    const offer = await createOffer();
    expect(await jobsFor(offer.id)).toBe(1);
    await patch(t.app, offerUrl(offer.id), { priceMinor: 5_000 }, adminCookie);
    expect(await jobsFor(offer.id)).toBe(1);
    const policy = await patch(
      t.app,
      offerUrl(offer.id),
      { cancellationPolicy: 'No refunds.' },
      adminCookie,
    );
    expect(policy.json().translation).toMatchObject({ status: 'pending', revision: 2 });
    expect(await jobsFor(offer.id)).toBe(2);
  });

  it('lists the translations and refuses a retry that has not failed', async () => {
    const offer = await createOffer();
    const view = await get(t.app, `${offerUrl(offer.id)}/translations`, adminCookie);
    expect(view.json().languages).toHaveLength(7);
    const retry = await post(t.app, `${offerUrl(offer.id)}/translations/retry`, {}, adminCookie);
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual({ error: 'translation-not-failed' });
  });
});

describe('slots', () => {
  const bulk = (offerId: string, body: Record<string, unknown>) =>
    post(t.app, `${offerUrl(offerId)}/slots/bulk`, body, adminCookie);
  const week = { from: '2027-01-04', to: '2027-01-10', weekdays: ALL_DAYS, times: ['09:00'] };

  it('bulk-creates slots from a weekly schedule, once', async () => {
    const offer = await createOffer();
    const first = await bulk(offer.id, { ...week, capacity: 12 });
    expect(first.json()).toEqual({ created: 7, skipped: 0 });
    const again = await bulk(offer.id, { ...week, capacity: 12 });
    expect(again.json()).toEqual({ created: 0, skipped: 7 });
    const list = await get(t.app, `${offerUrl(offer.id)}/slots`, adminCookie);
    expect(list.json().timezone).toBe('Europe/Zagreb');
    expect(list.json().slots).toHaveLength(7);
    expect(list.json().slots[0]).toMatchObject({
      startsAt: '2027-01-04T09:00',
      capacity: 12,
      remaining: 12,
    });
    const past = await get(t.app, `${offerUrl(offer.id)}/slots?past=true`, adminCookie);
    expect(past.json().slots).toHaveLength(0);
  });

  it('refuses bulk creation on an on-request Offer and bad schedules', async () => {
    const onRequest = await createOffer({ availabilityMode: 'on_request' });
    expect((await bulk(onRequest.id, { ...week, capacity: 5 })).statusCode).toBe(400);
    const offer = await createOffer();
    const long = await bulk(offer.id, { ...week, to: '2028-01-05', capacity: 5 });
    expect(long.statusCode).toBe(400);
    expect((await bulk(offer.id, { ...week, times: [], capacity: 5 })).statusCode).toBe(400);
    expect((await bulk(offer.id, { ...week, weekdays: [], capacity: 5 })).statusCode).toBe(400);
    expect((await bulk(offer.id, { ...week, capacity: 0 })).statusCode).toBe(400);
  });

  it('skips a time missing on the spring-forward day', async () => {
    const offer = await createOffer();
    const response = await bulk(offer.id, {
      from: '2027-03-22',
      to: '2027-03-28',
      weekdays: ALL_DAYS,
      times: ['02:30'],
      capacity: 4,
    });
    expect(response.json()).toEqual({ created: 6, skipped: 1 });
  });

  it('edits capacity, keeps taken seats and guards deletes', async () => {
    const offer = await createOffer();
    await bulk(offer.id, { ...week, capacity: 12 });
    const [first, second] = (await get(t.app, `${offerUrl(offer.id)}/slots`, adminCookie)).json()
      .slots as { id: string }[];
    if (!first || !second) throw new Error('no slots');
    const slotUrl = (id: string) => `/api/admin/allotment-slots/${id}`;

    const grown = await patch(t.app, slotUrl(first.id), { capacity: 20 }, adminCookie);
    expect(grown.json()).toMatchObject({
      capacity: 20,
      remaining: 20,
      startsAt: '2027-01-04T09:00',
    });

    // Simulates three seats taken by Orders (ticket 15).
    await t.db.update(allotmentSlots).set({ remaining: 17 }).where(eq(allotmentSlots.id, first.id));
    const tooSmall = await patch(t.app, slotUrl(first.id), { capacity: 2 }, adminCookie);
    expect(tooSmall.statusCode).toBe(409);
    expect(tooSmall.json()).toEqual({ error: 'seats-taken' });
    expect(
      (await patch(t.app, slotUrl(first.id), { capacity: 3 }, adminCookie)).json(),
    ).toMatchObject({ capacity: 3, remaining: 0 });
    expect((await del(t.app, slotUrl(first.id), adminCookie)).json()).toEqual({
      error: 'seats-taken',
    });
    expect((await del(t.app, offerUrl(offer.id), adminCookie)).json()).toEqual({
      error: 'seats-taken',
    });

    const mode = await patch(
      t.app,
      offerUrl(offer.id),
      { availabilityMode: 'on_request' },
      adminCookie,
    );
    expect(mode.statusCode).toBe(409);
    expect(mode.json()).toEqual({ error: 'offer-has-slots' });

    expect((await del(t.app, slotUrl(second.id), adminCookie)).statusCode).toBe(204);
    expect((await del(t.app, slotUrl(second.id), adminCookie)).statusCode).toBe(404);
  });
});

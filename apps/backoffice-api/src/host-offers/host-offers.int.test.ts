import {
  accounts,
  allotmentSlots,
  createJobQueue,
  createOrder,
  properties,
  QUEUES,
} from '@fetivi/domain';
import { type SeededGuestUnit, seedGuestUnit } from '@fetivi/domain/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;
let guest: SeededGuestUnit;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Airport transfer',
  description: 'From Split airport to the door.',
  cancellationPolicy: 'Free until 24 hours before.',
  category: 'transfer',
  orderKind: 'booking',
  availabilityMode: 'on_request',
  paymentMode: 'direct',
  priceMinor: 6_000,
  ...extra,
});

async function create(cookie = hostA.cookie, extra: Record<string, unknown> = {}) {
  const response = await post(t.app, '/api/host/offers', body(extra), cookie);
  expect(response.statusCode).toBe(201);
  return response.json();
}

const jobsFor = async (offerId: string) => {
  const { rows } = await t.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateOffer} and data->>'offerId' = ${offerId}`,
  );
  return rows[0]?.n ?? 0;
};

beforeAll(async () => {
  t = await createTestApp();
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
  // Host A's property is in London: own Offers' slots are in the host's zone.
  guest = await seedGuestUnit(t.db, { now: t.clock.now() });
  await t.db
    .update(properties)
    .set({ hostId: hostA.id, timezone: 'Europe/London' })
    .where(eq(properties.id, guest.propertyId));
});

afterAll(async () => {
  await t?.close();
});

describe('own Offers', () => {
  it('needs a host session', async () => {
    expect((await get(t.app, '/api/host/offers')).statusCode).toBe(401);
    expect((await post(t.app, '/api/host/offers', body(), adminCookie)).statusCode).toBe(403);
  });

  it('creates with defaults, enqueues the translation, edits and lists', async () => {
    const offer = await create();
    expect(offer).toMatchObject({
      title: 'Airport transfer',
      provider: null,
      destination: null,
      place: null,
      placeId: null,
      adapterKind: null,
      timezone: 'Europe/London',
      currency: 'EUR',
      responseWindowMinutes: 30,
      active: true,
      translation: { status: 'pending', revision: 1, publishedRevision: null },
    });
    expect(await jobsFor(offer.id)).toBe(1);
    const edited = await patch(
      t.app,
      `/api/host/offers/${offer.id}`,
      { priceMinor: 7_000, active: false },
      hostA.cookie,
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ priceMinor: 7_000, active: false });
    const list = (await get(t.app, '/api/host/offers', hostA.cookie)).json();
    expect(list.offers.map((o: { id: string }) => o.id)).toContain(offer.id);
    const theirs = (await get(t.app, '/api/host/offers', hostB.cookie)).json();
    expect(theirs.offers.map((o: { id: string }) => o.id)).not.toContain(offer.id);
  });

  it.each([
    ['live mode', { availabilityMode: 'live' }],
    ['a place', { placeId: '00000000-0000-4000-8000-000000000000' }],
    ['a destination', { destinationId: '00000000-0000-4000-8000-000000000000' }],
    ['an adapter', { adapterKind: 'bokun' }],
    ['a commission', { commissionBp: 0 }],
    ['an owner', { hostId: '00000000-0000-4000-8000-000000000000' }],
    ['a booking without a price', { priceMinor: null }],
    ['a request on allotment', { orderKind: 'request', availabilityMode: 'allotment' }],
  ])('refuses %s', async (_, extra) => {
    const response = await post(t.app, '/api/host/offers', body(extra), hostA.cookie);
    expect(response.statusCode).toBe(400);
  });

  it('refuses live and a place on patch', async () => {
    const offer = await create();
    const url = `/api/host/offers/${offer.id}`;
    expect((await patch(t.app, url, { availabilityMode: 'live' }, hostA.cookie)).statusCode).toBe(
      400,
    );
    expect((await patch(t.app, url, { placeId: null }, hostA.cookie)).statusCode).toBe(400);
  });

  it("is 404 for another host on every route, and for the admin's Offer routes", async () => {
    const offer = await create(hostA.cookie, { availabilityMode: 'allotment' });
    const url = `/api/host/offers/${offer.id}`;
    const bulk = {
      from: '2027-06-01',
      to: '2027-06-01',
      weekdays: [2],
      times: ['09:00'],
      capacity: 4,
    };
    expect((await post(t.app, `${url}/slots/bulk`, bulk, hostA.cookie)).statusCode).toBe(200);
    const [slot] = await t.db
      .select()
      .from(allotmentSlots)
      .where(eq(allotmentSlots.offerId, offer.id));
    if (!slot) throw new Error('no slot');
    const b = hostB.cookie;
    expect((await get(t.app, url, b)).statusCode).toBe(404);
    expect((await patch(t.app, url, { title: 'Mine' }, b)).statusCode).toBe(404);
    expect((await del(t.app, url, b)).statusCode).toBe(404);
    expect((await get(t.app, `${url}/slots`, b)).statusCode).toBe(404);
    expect((await post(t.app, `${url}/slots/bulk`, bulk, b)).statusCode).toBe(404);
    expect((await get(t.app, `${url}/translations`, b)).statusCode).toBe(404);
    expect((await post(t.app, `${url}/translations/retry`, {}, b)).statusCode).toBe(404);
    const slotUrl = `/api/host/allotment-slots/${slot.id}`;
    expect((await patch(t.app, slotUrl, { capacity: 6 }, b)).statusCode).toBe(404);
    expect((await del(t.app, slotUrl, b)).statusCode).toBe(404);
    // Admin Offer pages never show a host's own Offer.
    expect((await get(t.app, `/api/admin/offers/${offer.id}`, adminCookie)).statusCode).toBe(404);
    expect((await get(t.app, url, hostA.cookie)).statusCode).toBe(200);
  });

  it("takes slot times in the host's zone", async () => {
    const offer = await create(hostA.cookie, { availabilityMode: 'allotment' });
    const url = `/api/host/offers/${offer.id}`;
    const bulk = {
      from: '2027-06-01',
      to: '2027-06-01',
      weekdays: [2],
      times: ['09:00'],
      capacity: 4,
    };
    const created = await post(t.app, `${url}/slots/bulk`, bulk, hostA.cookie);
    expect(created.json()).toEqual({ created: 1, skipped: 0 });
    const [slot] = await t.db
      .select()
      .from(allotmentSlots)
      .where(eq(allotmentSlots.offerId, offer.id));
    // 09:00 in London in June is 08:00 UTC.
    expect(slot?.startsAt.toISOString()).toBe('2027-06-01T08:00:00.000Z');
    const listed = (await get(t.app, `${url}/slots`, hostA.cookie)).json();
    expect(listed).toMatchObject({
      timezone: 'Europe/London',
      slots: [{ startsAt: '2027-06-01T09:00', capacity: 4, remaining: 4 }],
    });
    const slotUrl = `/api/host/allotment-slots/${slot?.id}`;
    const capped = await patch(t.app, slotUrl, { capacity: 6 }, hostA.cookie);
    expect(capped.json()).toMatchObject({ startsAt: '2027-06-01T09:00', capacity: 6 });
    expect((await del(t.app, slotUrl, hostA.cookie)).statusCode).toBe(204);
  });

  it('lists translations', async () => {
    const offer = await create();
    const response = await get(t.app, `/api/host/offers/${offer.id}/translations`, hostA.cookie);
    expect(response.statusCode).toBe(200);
  });

  it('deletes an Offer without Orders; one with Orders is 409', async () => {
    const unused = await create();
    expect((await del(t.app, `/api/host/offers/${unused.id}`, hostA.cookie)).statusCode).toBe(204);
    const used = await create();
    await createOrder(
      { db: t.db, queue: createJobQueue(t.boss), now: t.clock.now },
      {
        spaceId: guest.spaceId,
        offerId: used.id,
        date: '2026-10-22',
        quantity: 1,
        contact: { email: 'guest@example.test' },
      },
    );
    const refused = await del(t.app, `/api/host/offers/${used.id}`, hostA.cookie);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'offer-has-orders' });
  });

  it('an admin acting as the host can edit, and the write is audited', async () => {
    const offer = await create();
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const edited = await patch(
        t.app,
        `/api/host/offers/${offer.id}`,
        { title: 'Airport transfer (van)' },
        adminCookie,
      );
      expect(edited.statusCode).toBe(200);
      expect(edited.json().translation.revision).toBe(2);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
    await vi.waitFor(async () => {
      const audit = await get(t.app, '/api/admin/audit', adminCookie);
      expect(audit.json().entries.map((e: { route: string }) => e.route)).toContain(
        '/api/host/offers/:id',
      );
    });
  });
});

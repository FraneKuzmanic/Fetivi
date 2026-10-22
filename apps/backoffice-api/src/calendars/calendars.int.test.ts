import { accounts, createJobQueue, pollFeed, QUEUES, uuidFrom } from '@fetivi/domain';
import { ics, type StubResponse, stubFetch } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  del,
  fillGoLiveMinimum,
  GUEST_TEST_ORIGIN,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

// The test clock starts at 2026-10-19T10:00:00Z (12:00 in Zagreb).
const OCT_24 = { checkIn: '2026-10-24', checkout: '2026-10-27' };
const AIRBNB = 'https://www.airbnb.com/calendar/ical/111.ics?s=topsecret';
const BOOKING = 'https://ical.booking.com/v1/export?t=bookingsecret';

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  return { id: row?.id as string, cookie: await loginAs(t, email) };
}

/** A property with one unit that meets the go-live minimum; approved (live) unless told otherwise. */
async function unitOf(cookie: string, approve = true) {
  const property = await post(t.app, '/api/host/properties', { name: 'Villa Mare' }, cookie);
  const propertyId = property.json().id as string;
  const unit = await post(
    t.app,
    `/api/host/properties/${propertyId}/units`,
    { name: 'Apartment 1' },
    cookie,
  );
  const unitId = unit.json().id as string;
  await fillGoLiveMinimum(t.app, cookie, { propertyId, unitId });
  if (approve) {
    const approved = await post(
      t.app,
      `/api/admin/properties/${propertyId}/approve`,
      undefined,
      adminCookie,
    );
    expect(approved.statusCode).toBeLessThan(300);
  }
  return { unitId, propertyId };
}

const addCalendar = (unitId: string, url: string, cookie = hostA.cookie) =>
  post(t.app, `/api/host/units/${unitId}/calendars`, { url }, cookie);

async function added(unitId: string, url: string) {
  const r = await addCalendar(unitId, url);
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string; source: string; label: string };
}

const poll = (feedId: string, response: StubResponse) =>
  pollFeed(
    { db: t.db, queue: createJobQueue(t.boss), now: t.clock.now, fetch: stubFetch([response]) },
    feedId,
  );

const proposalsOf = async (unitId: string, cookie = hostA.cookie) => {
  const r = await get(t.app, `/api/host/stay-proposals?unitId=${unitId}`, cookie);
  expect(r.statusCode).toBe(200);
  return r.json();
};

beforeAll(async () => {
  t = await createTestApp();
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
});

afterAll(async () => {
  await t?.close();
});

describe('calendar feeds', () => {
  it('adds a feed without echoing its secret and polls it at once', async () => {
    const { unitId } = await unitOf(hostA.cookie);
    const r = await addCalendar(
      unitId,
      'https://www.airbnb.co.uk/calendar/ical/111.ics?s=topsecret',
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      source: 'airbnb',
      label: 'www.airbnb.com/calendar/ical/111.ics',
      lastPolledAt: null,
    });
    expect(r.body).not.toContain('topsecret');
    expect(r.body).not.toContain('s=');
    const job = await t.boss.getJobById(
      QUEUES.pollCalendar,
      uuidFrom(`calendar:${r.json().id}:added`),
    );
    expect(job?.data).toEqual({ feedId: r.json().id });
    const list = await get(t.app, `/api/host/units/${unitId}/calendars`, hostA.cookie);
    expect(list.json().feeds).toHaveLength(1);
    expect(list.body).not.toContain('topsecret');
  });

  it('rejects duplicates, a seventh feed, bad URLs, units not live and other hosts', async () => {
    const { unitId } = await unitOf(hostA.cookie);
    await added(unitId, AIRBNB);
    const dup = await addCalendar(unitId, AIRBNB);
    expect([dup.statusCode, dup.json().error]).toEqual([409, 'calendar-exists']);
    for (let i = 0; i < 5; i++) await added(unitId, `${BOOKING}${i}`);
    const seventh = await addCalendar(unitId, `${BOOKING}x`);
    expect([seventh.statusCode, seventh.json().error]).toEqual([409, 'too-many-calendars']);
    const bad = await addCalendar(unitId, 'https://evil.com/cal.ics');
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'invalid-calendar-url']);

    const notLive = await unitOf(hostA.cookie, false);
    const r = await addCalendar(notLive.unitId, AIRBNB);
    expect([r.statusCode, r.json().error]).toEqual([409, 'unit-not-live']);

    expect((await addCalendar(unitId, `${AIRBNB}2`, hostB.cookie)).statusCode).toBe(404);
    expect((await get(t.app, `/api/host/units/${unitId}/calendars`, hostB.cookie)).statusCode).toBe(
      404,
    );
  });

  it('asks for the Booking.com domain approval until the host marks it done', async () => {
    const { unitId, propertyId } = await unitOf(hostA.cookie);
    const before = await get(t.app, `/api/host/units/${unitId}/calendars`, hostA.cookie);
    expect(before.json().bookingLinks).toMatchObject({ needed: false, approvedAt: null });
    await added(unitId, BOOKING);
    const needed = await get(t.app, `/api/host/units/${unitId}/calendars`, hostA.cookie);
    expect(needed.json().bookingLinks).toEqual({
      needed: true,
      approvedAt: null,
      domain: new URL(GUEST_TEST_ORIGIN).host,
      propertyId,
    });
    expect((await proposalsOf(unitId)).bookingLinks.pending).toEqual([
      { propertyId, propertyName: 'Villa Mare' },
    ]);
    const other = await post(
      t.app,
      `/api/host/properties/${propertyId}/booking-links-approved`,
      undefined,
      hostB.cookie,
    );
    expect(other.statusCode).toBe(404);
    const done = await post(
      t.app,
      `/api/host/properties/${propertyId}/booking-links-approved`,
      undefined,
      hostA.cookie,
    );
    expect(done.statusCode).toBe(204);
    const after = await get(t.app, `/api/host/units/${unitId}/calendars`, hostA.cookie);
    expect(after.json().bookingLinks.needed).toBe(false);
    expect((await proposalsOf(unitId)).bookingLinks.pending).toEqual([]);
  });
});

describe('stay proposals', () => {
  it('confirms a proposal into a Stay with a PIN, once', async () => {
    const { unitId } = await unitOf(hostA.cookie);
    const feed = await added(unitId, AIRBNB);
    await poll(
      feed.id,
      ics([
        { uid: 'a', ...OCT_24 },
        { uid: 'b', checkIn: '2026-11-02', checkout: '2026-11-05' },
      ]),
    );
    const { proposals } = await proposalsOf(unitId);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ ...OCT_24, sources: ['airbnb'], unitName: 'Apartment 1' });
    const asB = await get(t.app, `/api/host/stay-proposals?unitId=${unitId}`, hostB.cookie);
    expect(asB.statusCode).toBe(404);
    expect((await get(t.app, '/api/host/stay-proposals', hostB.cookie)).json().proposals).toEqual(
      [],
    );

    const id = proposals[0].id as string;
    const byB = await post(
      t.app,
      `/api/host/stay-proposals/${id}/confirm`,
      { partySize: 2 },
      hostB.cookie,
    );
    expect(byB.statusCode).toBe(404);
    const bad = await post(
      t.app,
      `/api/host/stay-proposals/${id}/confirm`,
      { partySize: 2, checkIn: '2026-10-25' },
      hostA.cookie,
    );
    expect(bad.statusCode).toBe(400);
    const confirmed = await post(
      t.app,
      `/api/host/stay-proposals/${id}/confirm`,
      { partySize: 2 },
      hostA.cookie,
    );
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({ ...OCT_24, calendarSources: ['airbnb'] });
    expect(confirmed.json().pin).toMatch(/^\d{6}$/);
    const again = await post(
      t.app,
      `/api/host/stay-proposals/${id}/confirm`,
      { partySize: 2 },
      hostA.cookie,
    );
    expect([again.statusCode, again.json().error]).toEqual([409, 'proposal-gone']);

    const other = proposals[1].id as string;
    const dismissed = await post(
      t.app,
      `/api/host/stay-proposals/${other}/dismiss`,
      undefined,
      hostA.cookie,
    );
    expect(dismissed.statusCode).toBe(204);
    expect((await proposalsOf(unitId)).proposals).toEqual([]);
  });

  it('keeps a possibly cancelled Stay', async () => {
    const { unitId } = await unitOf(hostA.cookie);
    const feed = await added(unitId, AIRBNB);
    await poll(feed.id, ics([{ uid: 'k', ...OCT_24 }]));
    const id = (await proposalsOf(unitId)).proposals[0].id as string;
    const stay = (
      await post(t.app, `/api/host/stay-proposals/${id}/confirm`, { partySize: 2 }, hostA.cookie)
    ).json();
    const notFlagged = await post(
      t.app,
      `/api/host/stays/${stay.id}/keep`,
      undefined,
      hostA.cookie,
    );
    expect([notFlagged.statusCode, notFlagged.json().error]).toEqual([
      409,
      'not-possibly-cancelled',
    ]);
    await poll(feed.id, ics([]));
    const flagged = await get(t.app, `/api/host/stays/${stay.id}`, hostA.cookie);
    expect(flagged.json().possiblyCancelled).toBe(true);
    expect(
      (await post(t.app, `/api/host/stays/${stay.id}/keep`, undefined, hostB.cookie)).statusCode,
    ).toBe(404);
    const kept = await post(t.app, `/api/host/stays/${stay.id}/keep`, undefined, hostA.cookie);
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ possiblyCancelled: false, calendarSources: ['airbnb'] });
  });

  it('removing a feed drops its proposals and keeps its Stays', async () => {
    const { unitId } = await unitOf(hostA.cookie);
    const feed = await added(unitId, AIRBNB);
    await poll(
      feed.id,
      ics([
        { uid: 'a', ...OCT_24 },
        { uid: 'b', checkIn: '2026-11-02', checkout: '2026-11-05' },
      ]),
    );
    const id = (await proposalsOf(unitId)).proposals[0].id as string;
    const stay = (
      await post(t.app, `/api/host/stay-proposals/${id}/confirm`, { partySize: 2 }, hostA.cookie)
    ).json();
    expect((await del(t.app, `/api/host/calendars/${feed.id}`, hostB.cookie)).statusCode).toBe(404);
    expect((await del(t.app, `/api/host/calendars/${feed.id}`, hostA.cookie)).statusCode).toBe(204);
    expect((await proposalsOf(unitId)).proposals).toEqual([]);
    const after = await get(t.app, `/api/host/stays/${stay.id}`, hostA.cookie);
    expect(after.statusCode).toBe(200);
    expect(after.json().calendarSources).toEqual([]);
  });
});

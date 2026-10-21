import { accounts } from '@fetivi/domain';
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
  patch,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

// The test clock starts at 2026-10-19T10:00:00Z (12:00 in Zagreb).
const HOUR = 3_600_000;
const STAY = { checkIn: '2026-10-24', checkout: '2026-10-27', partySize: 2 };

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;
let liveUnit: { id: string; qrSlug: string };

async function idOf(email: string) {
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return row.id;
}

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  return { id: await idOf(email), cookie: await loginAs(t, email) };
}

/**
 * A property with one unit; approved unless told otherwise. The unit meets the go-live minimum
 * (so approval makes it live) unless `ready` is false.
 */
async function unitOf(cookie: string, approve = true, ready = true) {
  const property = await post(t.app, '/api/host/properties', { name: 'Villa Mare' }, cookie);
  expect(property.statusCode).toBe(201);
  const propertyId = property.json().id as string;
  const unit = await post(
    t.app,
    `/api/host/properties/${propertyId}/units`,
    { name: 'Apartment 1' },
    cookie,
  );
  expect(unit.statusCode).toBe(201);
  if (ready) await fillGoLiveMinimum(t.app, cookie, { propertyId, unitId: unit.json().id });
  if (approve) {
    const approved = await post(
      t.app,
      `/api/admin/properties/${propertyId}/approve`,
      undefined,
      adminCookie,
    );
    expect(approved.statusCode).toBeLessThan(300);
  }
  const detail = await get(t.app, `/api/host/units/${unit.json().id}`, cookie);
  return { id: detail.json().id as string, qrSlug: detail.json().qrSlug as string, propertyId };
}

const register = (unitId: string, body: object = STAY, cookie = hostA.cookie) =>
  post(t.app, `/api/host/units/${unitId}/stays`, body, cookie);

async function registered(body: object = STAY) {
  const r = await register(liveUnit.id, body);
  expect(r.statusCode).toBe(201);
  return r.json();
}

beforeAll(async () => {
  t = await createTestApp();
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
  liveUnit = await unitOf(hostA.cookie);
});

afterAll(async () => {
  await t?.close();
});

describe('registering a Stay', () => {
  it('returns a six-digit PIN, the unit link without the PIN and the release time', async () => {
    const stay = await registered();
    expect(stay.pin).toMatch(/^\d{6}$/);
    expect(stay.unitLink).toBe(`${GUEST_TEST_ORIGIN}/u/${liveUnit.qrSlug}`);
    expect(stay.unitLink).not.toContain(stay.pin);
    expect(stay.arrivalReleaseLocal).toBe('2026-10-23T00:00');
    expect(stay.timezone).toBe('Europe/Zagreb');
    expect(stay.phase).toBe('upcoming');
    expect(stay.pinWarning).toBe(false);
    expect(stay.pinSentAt).toBeNull();
    expect(stay.possiblyCancelled).toBe(false);
    expect(stay.handoverLanguage).toBe('en');
  });

  it('stores the optional booker fields and the hand-over language', async () => {
    const stay = await registered({
      ...STAY,
      bookerName: ' Anna <b>Schmidt</b> ',
      reservationNumber: 'HM123',
      handoverLanguage: 'de',
    });
    expect(stay.bookerName).toBe('Anna Schmidt');
    expect(stay.reservationNumber).toBe('HM123');
    expect(stay.handoverLanguage).toBe('de');
  });

  it('refuses a unit of a property Fetivi has not approved', async () => {
    const unit = await unitOf(hostA.cookie, false);
    const r = await register(unit.id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'unit-not-live' });
  });

  it('refuses an approved unit below the go-live minimum', async () => {
    const unit = await unitOf(hostA.cookie, true, false);
    const r = await register(unit.id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'unit-not-live' });
  });

  it('refuses a suspended host, also when an admin acts for them', async () => {
    const c = await host('c@example.test');
    const unit = await unitOf(c.cookie);
    await post(t.app, `/api/admin/hosts/${c.id}/suspend`, undefined, adminCookie);
    await post(t.app, '/api/admin/act-as', { hostId: c.id }, adminCookie);
    try {
      const r = await register(unit.id, STAY, adminCookie);
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'account-suspended' });
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
  });

  it.each([
    ['a PIN', { pin: '123456' }],
    ['a unit id', { unitId: '00000000-0000-0000-0000-000000000000' }],
    ['an active-until instant', { activeUntil: '2027-01-01T00:00:00Z' }],
    ['the possibly-cancelled flag', { possiblyCancelled: true }],
  ])('rejects a body carrying %s', async (_, extra) => {
    const r = await register(liveUnit.id, { ...STAY, ...extra });
    expect(r.statusCode).toBe(400);
  });

  it.each([
    ['checkout before check-in', { checkIn: '2026-10-24', checkout: '2026-10-22' }],
    ['91 nights', { checkIn: '2026-11-01', checkout: '2027-01-31' }],
    ['a Stay that has already ended', { checkIn: '2026-10-10', checkout: '2026-10-18' }],
    ['an impossible date', { checkIn: '2026-11-31', checkout: '2026-12-02' }],
    ['party size 0', { partySize: 0 }],
  ])('rejects %s', async (_, extra) => {
    const r = await register(liveUnit.id, { ...STAY, ...extra });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'invalid-input' });
  });
});

describe('ownership', () => {
  let stayId: string;

  beforeAll(async () => {
    stayId = (await registered()).id;
  });

  it('hides another host’s Stay and unit as not found', async () => {
    expect((await get(t.app, `/api/host/stays/${stayId}`, hostB.cookie)).statusCode).toBe(404);
    expect(
      (await patch(t.app, `/api/host/stays/${stayId}`, { partySize: 3 }, hostB.cookie)).statusCode,
    ).toBe(404);
    expect((await del(t.app, `/api/host/stays/${stayId}`, hostB.cookie)).statusCode).toBe(404);
    expect((await register(liveUnit.id, STAY, hostB.cookie)).statusCode).toBe(404);
    expect(
      (await get(t.app, `/api/host/stays?unitId=${liveUnit.id}`, hostB.cookie)).statusCode,
    ).toBe(404);
  });

  it('never lists another host’s Stays', async () => {
    const r = await get(t.app, '/api/host/stays', hostB.cookie);
    expect(r.json().stays).toEqual([]);
  });
});

describe('changing and deleting a Stay', () => {
  it('keeps the PIN when the dates change and recomputes the release time', async () => {
    const stay = await registered();
    const r = await patch(
      t.app,
      `/api/host/stays/${stay.id}`,
      { checkIn: '2026-10-28', checkout: '2026-10-30' },
      hostA.cookie,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().pin).toBe(stay.pin);
    expect(r.json().arrivalReleaseLocal).toBe('2026-10-27T00:00');
  });

  it('rejects a PIN or unit change in the body', async () => {
    const stay = await registered();
    for (const body of [{ pin: '000000' }, { unitId: liveUnit.id }]) {
      const r = await patch(t.app, `/api/host/stays/${stay.id}`, body, hostA.cookie);
      expect(r.statusCode).toBe(400);
    }
  });

  it('sets and clears the PIN-sent tick', async () => {
    const stay = await registered();
    const sent = await patch(t.app, `/api/host/stays/${stay.id}`, { pinSent: true }, hostA.cookie);
    expect(sent.json().pinSentAt).toBe(t.clock.now().toISOString());
    const unsent = await patch(
      t.app,
      `/api/host/stays/${stay.id}`,
      { pinSent: false },
      hostA.cookie,
    );
    expect(unsent.json().pinSentAt).toBeNull();
  });

  it('deletes a Stay', async () => {
    const stay = await registered();
    expect((await del(t.app, `/api/host/stays/${stay.id}`, hostA.cookie)).statusCode).toBe(204);
    expect((await get(t.app, `/api/host/stays/${stay.id}`, hostA.cookie)).statusCode).toBe(404);
  });

  it('moves the release time when the unit’s release offset changes', async () => {
    const stay = await registered();
    const r = await patch(
      t.app,
      `/api/host/units/${liveUnit.id}`,
      { arrivalReleaseDaysBefore: 3 },
      hostA.cookie,
    );
    expect(r.statusCode).toBe(200);
    const after = await get(t.app, `/api/host/stays/${stay.id}`, hostA.cookie);
    expect(after.json().arrivalReleaseLocal).toBe('2026-10-21T00:00');
    await patch(
      t.app,
      `/api/host/units/${liveUnit.id}`,
      { arrivalReleaseDaysBefore: 1 },
      hostA.cookie,
    );
  });
});

// These move the shared clock forward, so they run last.
describe('over time', () => {
  let other: { id: string };
  let warned: { id: string };
  let ending: { id: string };

  beforeAll(async () => {
    other = await unitOf(hostA.cookie);
    warned = await registered();
    const r = await register(other.id, {
      checkIn: '2026-10-19',
      checkout: '2026-10-21',
      partySize: 1,
    });
    ending = r.json();
  });

  it('filters the list by unit', async () => {
    const r = await get(t.app, `/api/host/stays?unitId=${other.id}`, hostA.cookie);
    expect(r.json().stays.map((s: { id: string }) => s.id)).toEqual([ending.id]);
  });

  it('warns from 00:00 Zagreb three days before check-in until the PIN is ticked as sent', async () => {
    const at = async () =>
      (await get(t.app, `/api/host/stays/${warned.id}`, hostA.cookie)).json().pinWarning;
    expect(await at()).toBe(false);
    t.clock.advance(36 * HOUR - 1); // 2026-10-20T21:59:59.999Z, 23:59 in Zagreb
    expect(await at()).toBe(false);
    t.clock.advance(1); // 00:00 on 21 October in Zagreb
    expect(await at()).toBe(true);
    await patch(t.app, `/api/host/stays/${warned.id}`, { pinSent: true }, hostA.cookie);
    expect(await at()).toBe(false);
  });

  it('moves a Stay to the past list at the end of checkout day and refuses edits then', async () => {
    t.clock.advance(24 * HOUR); // 2026-10-21T22:00Z, 00:00 on 22 October in Zagreb
    const current = await get(t.app, `/api/host/stays?unitId=${other.id}`, hostA.cookie);
    expect(current.json().stays).toEqual([]);
    const past = await get(t.app, `/api/host/stays?unitId=${other.id}&past=true`, hostA.cookie);
    expect(past.json().stays.map((s: { id: string }) => s.id)).toEqual([ending.id]);
    expect(past.json().stays[0].phase).toBe('ended');

    const edit = await patch(t.app, `/api/host/stays/${ending.id}`, { partySize: 2 }, hostA.cookie);
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toEqual({ error: 'stay-ended' });
    expect((await del(t.app, `/api/host/stays/${ending.id}`, hostA.cookie)).statusCode).toBe(204);
  });
});

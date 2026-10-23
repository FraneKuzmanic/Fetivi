import {
  accounts,
  catalogRecords,
  curationItems,
  hostPlaces,
  properties,
  QUEUES,
} from '@fetivi/domain';
import {
  publishCatalog,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
} from '@fetivi/domain/testing';
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
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

// Host picks and host-added places over HTTP (40): ownership, error codes, act-as audit, and
// AC 5: a host can never write a catalog record.

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;
let guest: SeededGuestUnit;
let destinationId: string;
let beachId: string;
let barId: string;
let nowherePropertyId: string;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

const IN_TROGIR = { lat: 43.517, lng: 16.252 };
const ADDED = {
  name: 'Bakery Lucija',
  placeCategory: 'shop',
  location: IN_TROGIR,
  note: 'Burek from six',
};

const picksUrl = () => `/api/host/properties/${guest.propertyId}/picks`;
const addedUrl = () => `/api/host/properties/${guest.propertyId}/added-places`;
const recordRow = async (id: string) =>
  (await t.db.execute(sql`select * from catalog_records where id = ${id}`)).rows[0];
const jobsFor = async (hostPlaceId: string) => {
  const { rows } = await t.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.translateHostPlace} and data->>'hostPlaceId' = ${hostPlaceId}`,
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
  destinationId = await seedDestination(t.db);
  guest = await seedGuestUnit(t.db, { now: t.clock.now() });
  await t.db
    .update(properties)
    .set({ hostId: hostA.id })
    .where(eq(properties.id, guest.propertyId));
  const nowhere = await seedGuestUnit(t.db, { now: t.clock.now(), location: null });
  nowherePropertyId = nowhere.propertyId;
  await t.db
    .update(properties)
    .set({ hostId: hostA.id })
    .where(eq(properties.id, nowherePropertyId));
  const insert = async (title: string, placeCategory: 'beach' | 'cafe_bar') => {
    const [r] = await t.db
      .insert(catalogRecords)
      .values({
        destinationId,
        kind: 'place',
        title,
        description: `${title}, a good place.`,
        placeCategory,
        location: { x: 16.26, y: 43.52 },
      })
      .returning();
    if (!r) throw new Error('no record');
    return r.id;
  };
  beachId = await insert('Plaza Pantan', 'beach');
  barId = await insert('Bar Mare', 'cafe_bar');
  await publishCatalog(t.db, destinationId);
});

afterAll(async () => {
  await t?.close();
});

describe('host picks', () => {
  it('needs a host session', async () => {
    expect((await get(t.app, picksUrl())).statusCode).toBe(401);
    expect((await post(t.app, picksUrl(), { recordId: beachId }, adminCookie)).statusCode).toBe(
      403,
    );
  });

  it('browses the catalog of the property destination', async () => {
    const response = await get(
      t.app,
      `/api/host/properties/${guest.propertyId}/catalog-places?q=pantan`,
      hostA.cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().places).toEqual([
      expect.objectContaining({ id: beachId, title: 'Plaza Pantan', picked: false }),
    ]);
  });

  it('picks a place with a note, refuses a second pick, edits the note and removes it', async () => {
    const before = await recordRow(beachId);
    const created = await post(
      t.app,
      picksUrl(),
      { recordId: beachId, note: 'Go before ten' },
      hostA.cookie,
    );
    expect(created.statusCode).toBe(201);
    const [pick] = created.json().picks;
    expect(pick).toMatchObject({ recordId: beachId, note: 'Go before ten' });
    expect(await jobsFor(pick.id)).toBe(1);

    const again = await post(t.app, picksUrl(), { recordId: beachId }, hostA.cookie);
    expect([again.statusCode, again.json()]).toEqual([409, { error: 'already-picked' }]);

    const edited = await patch(
      t.app,
      `/api/host/host-places/${pick.id}`,
      { note: 'Go before nine' },
      hostA.cookie,
    );
    expect(edited.statusCode).toBe(200);
    expect(edited.json().picks[0].note).toBe('Go before nine');
    const renamed = await patch(
      t.app,
      `/api/host/host-places/${pick.id}`,
      { name: 'Pantan' },
      hostA.cookie,
    );
    expect([renamed.statusCode, renamed.json()]).toEqual([400, { error: 'invalid-input' }]);

    expect((await del(t.app, `/api/host/host-places/${pick.id}`, hostA.cookie)).statusCode).toBe(
      204,
    );
    expect((await get(t.app, picksUrl(), hostA.cookie)).json().picks).toEqual([]);
    // AC 5: the catalog row is untouched by every host call.
    expect(await recordRow(beachId)).toEqual(before);
  });

  it('refuses a body carrying catalog fields', async () => {
    const before = await recordRow(barId);
    const response = await post(
      t.app,
      picksUrl(),
      { recordId: barId, title: 'Better bar', description: 'Mine now.' },
      hostA.cookie,
    );
    expect([response.statusCode, response.json()]).toEqual([400, { error: 'invalid-input' }]);
    expect(await recordRow(barId)).toEqual(before);
  });

  it('adds a place, enqueues its translation and one curation item', async () => {
    const response = await post(t.app, addedUrl(), { ...ADDED, address: 'Obala 3' }, hostA.cookie);
    expect(response.statusCode).toBe(201);
    const added = response.json().added.find((a: { name: string }) => a.name === ADDED.name);
    expect(added).toMatchObject({
      placeCategory: 'shop',
      location: IN_TROGIR,
      address: 'Obala 3',
      note: 'Burek from six',
      inCatalog: false,
    });
    expect(await jobsFor(added.id)).toBe(1);
    const items = await t.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.dedupeKey, `host-place:${added.id}`));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ hostId: hostA.id, destinationId });
    expect(items[0]?.payload).toMatchObject({
      kind: 'host_place_suggestion',
      hostPlaceId: added.id,
    });
  });

  it('refuses a place outside the destination, without a note, or outside any destination', async () => {
    const far = await post(
      t.app,
      addedUrl(),
      { ...ADDED, location: { lat: 45.815, lng: 15.9819 } },
      hostA.cookie,
    );
    expect([far.statusCode, far.json()]).toEqual([400, { error: 'outside-destination' }]);
    const { note: _n, ...noNote } = ADDED;
    expect((await post(t.app, addedUrl(), noNote, hostA.cookie)).statusCode).toBe(400);
    const nowhere = await post(
      t.app,
      `/api/host/properties/${nowherePropertyId}/added-places`,
      ADDED,
      hostA.cookie,
    );
    expect([nowhere.statusCode, nowhere.json()]).toEqual([400, { error: 'no-destination' }]);
    const browse = await get(
      t.app,
      `/api/host/properties/${nowherePropertyId}/catalog-places`,
      hostA.cookie,
    );
    expect([browse.statusCode, browse.json()]).toEqual([400, { error: 'no-destination' }]);
  });

  it('retries a failed translation only', async () => {
    const created = await post(t.app, addedUrl(), { ...ADDED, name: 'Fig tree' }, hostA.cookie);
    const added = created.json().added.find((a: { name: string }) => a.name === 'Fig tree');
    const url = `/api/host/host-places/${added.id}/translations/retry`;
    const notFailed = await post(t.app, url, {}, hostA.cookie);
    expect([notFailed.statusCode, notFailed.json()]).toEqual([
      409,
      { error: 'translation-not-failed' },
    ]);
    await t.db
      .update(hostPlaces)
      .set({ translationStatus: 'failed', translationError: 'model-error' })
      .where(eq(hostPlaces.id, added.id));
    const retried = await post(t.app, url, {}, hostA.cookie);
    expect(retried.statusCode).toBe(200);
    expect(
      retried.json().added.find((a: { id: string }) => a.id === added.id).translation.status,
    ).toBe('pending');
    expect(await jobsFor(added.id)).toBe(2);
  });

  it("answers 404 for another host's property or host place", async () => {
    const [row] = await t.db
      .select({ id: hostPlaces.id })
      .from(hostPlaces)
      .where(eq(hostPlaces.propertyId, guest.propertyId));
    if (!row) throw new Error('no host place');
    const b = hostB.cookie;
    expect((await get(t.app, picksUrl(), b)).statusCode).toBe(404);
    expect(
      (await get(t.app, `/api/host/properties/${guest.propertyId}/catalog-places`, b)).statusCode,
    ).toBe(404);
    expect((await post(t.app, picksUrl(), { recordId: barId }, b)).statusCode).toBe(404);
    expect((await post(t.app, addedUrl(), ADDED, b)).statusCode).toBe(404);
    const placeUrl = `/api/host/host-places/${row.id}`;
    expect((await patch(t.app, placeUrl, { note: 'Mine' }, b)).statusCode).toBe(404);
    expect((await del(t.app, placeUrl, b)).statusCode).toBe(404);
    expect((await post(t.app, `${placeUrl}/translations/retry`, {}, b)).statusCode).toBe(404);
    expect((await get(t.app, picksUrl(), hostA.cookie)).statusCode).toBe(200);
  });

  it('an admin acting as the host can pick, and the write is audited', async () => {
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const created = await post(t.app, picksUrl(), { recordId: barId }, adminCookie);
      expect(created.statusCode).toBe(201);
      expect(created.json().picks.map((p: { recordId: string }) => p.recordId)).toContain(barId);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
    await vi.waitFor(async () => {
      const audit = await get(t.app, '/api/admin/audit', adminCookie);
      expect(audit.json().entries.map((e: { route: string }) => e.route)).toContain(
        '/api/host/properties/:id/picks',
      );
    });
  });
});

describe('AC 5: hosts cannot edit catalog records', () => {
  it('refuses every admin catalog write to a host session', async () => {
    const before = await recordRow(beachId);
    const url = `/api/admin/catalog/records/${beachId}`;
    const c = hostA.cookie;
    const statuses = [
      (await patch(t.app, url, { title: 'Mine' }, c)).statusCode,
      (await put(t.app, `${url}/seasons`, { seasons: [] }, c)).statusCode,
      (await put(t.app, `${url}/opening-hours`, { openingHours: [] }, c)).statusCode,
      (await put(t.app, `${url}/images`, { images: [] }, c)).statusCode,
      (await post(t.app, `${url}/verify`, {}, c)).statusCode,
      (await del(t.app, url, c)).statusCode,
      (
        await post(
          t.app,
          `/api/admin/destinations/${destinationId}/records`,
          { kind: 'place', title: 'Mine' },
          c,
        )
      ).statusCode,
    ];
    expect(statuses).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(await recordRow(beachId)).toEqual(before);
  });
});

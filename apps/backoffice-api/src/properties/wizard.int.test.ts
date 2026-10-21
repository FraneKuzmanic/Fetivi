import { accounts, actAsAudit, infoBlocks } from '@fetivi/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  fillGoLiveMinimum,
  GO_LIVE_PROPERTY,
  get,
  loginAs,
  PASSWORD,
  patch,
  post,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

const STAY = { checkIn: '2026-10-24', checkout: '2026-10-27', partySize: 2 };

let t: TestApp;
let hostCookie: string;
let otherCookie: string;
let adminCookie: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  hostCookie = await loginAs(t, 'a@example.test');
  await signUpVerifiedHost(t, 'b@example.test');
  otherCookie = await loginAs(t, 'b@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
});

async function newUnit(cookie = hostCookie) {
  const property = await post(t.app, '/api/host/properties', { name: 'Villa Mare' }, cookie);
  const propertyId = property.json().id as string;
  const unit = await post(
    t.app,
    `/api/host/properties/${propertyId}/units`,
    { name: 'A1' },
    cookie,
  );
  return { propertyId, unitId: unit.json().id as string };
}

const wizard = (unitId: string, cookie = hostCookie) =>
  get(t.app, `/api/host/units/${unitId}/wizard`, cookie);
const goLive = (unitId: string, cookie = hostCookie) =>
  post(t.app, `/api/host/units/${unitId}/go-live`, undefined, cookie);
const approve = (propertyId: string) =>
  post(t.app, `/api/admin/properties/${propertyId}/approve`, undefined, adminCookie);

describe('wizard status', () => {
  it('starts a fresh unit at arrival with nothing filled', async () => {
    const { unitId } = await newUnit();
    const r = await wizard(unitId);
    expect(r.statusCode).toBe(200);
    const status = r.json();
    expect(status).toMatchObject({ resumeStep: 'arrival_access', live: false, approved: false });
    expect(status.progress.percent).toBe(0);
    expect(status.goLive.ready).toBe(false);
    expect(status.goLive.missing).toEqual([
      'approval',
      'address',
      'check_in_time',
      'check_in_method',
      'access_instructions',
      'checkout_time',
      'wifi',
      'host_phone',
    ]);
  });

  it('resumes at the next step once arrival is saved, keeping the values', async () => {
    const { propertyId, unitId } = await newUnit();
    const { checkoutTime, hostPhone, ...arrival } = GO_LIVE_PROPERTY;
    await patch(t.app, `/api/host/properties/${propertyId}`, arrival, hostCookie);
    const status = (await wizard(unitId)).json();
    expect(status.resumeStep).toBe('wifi_essentials');
    expect(status.progress.steps.arrival_access.missingRequired).toEqual([]);
    expect(status.fields.address).toEqual({ level: 'required', filled: true });
    const property = (await get(t.app, `/api/host/properties/${propertyId}`, hostCookie)).json();
    expect(property.accessInstructions).toBe(GO_LIVE_PROPERTY.accessInstructions);
  });

  it('branches on the property type', async () => {
    const { propertyId, unitId } = await newUnit();
    expect((await wizard(unitId)).json().fields.building_door_code).toBeDefined();
    await patch(t.app, `/api/host/properties/${propertyId}`, { propertyType: 'house' }, hostCookie);
    const house = (await wizard(unitId)).json();
    expect(house.propertyType).toBe('house');
    expect(house.fields.building_door_code).toBeUndefined();
    await patch(t.app, `/api/host/properties/${propertyId}`, { propertyType: 'room' }, hostCookie);
    expect((await wizard(unitId)).json().fields.shared_spaces.level).toBe('recommended');
    const bad = await patch(
      t.app,
      `/api/host/properties/${propertyId}`,
      { propertyType: 'castle' },
      hostCookie,
    );
    expect(bad.statusCode).toBe(400);
  });

  it('marks a prompt filled by a block with its wizard key', async () => {
    const { propertyId, unitId } = await newUnit();
    const block = await post(
      t.app,
      `/api/host/properties/${propertyId}/blocks`,
      {
        category: 'house_rules_checkout',
        title: 'Before you leave',
        body: 'Leave the keys on the table.',
        wizardKey: 'checkout_steps',
      },
      hostCookie,
    );
    expect(block.statusCode).toBe(201);
    expect(block.json().block.wizardKey).toBe('checkout_steps');
    expect((await wizard(unitId)).json().fields.checkout_steps.filled).toBe(true);

    const bad = await post(
      t.app,
      `/api/host/properties/${propertyId}/blocks`,
      { category: 'how_tos', title: 'X', body: 'Y', wizardKey: 'not_a_prompt' },
      hostCookie,
    );
    expect(bad.statusCode).toBe(400);

    // A unit block replacing it answers the same prompt.
    const replacement = await post(
      t.app,
      `/api/host/units/${unitId}/blocks`,
      {
        category: 'house_rules_checkout',
        title: 'Before you leave A1',
        body: 'Keys in the box.',
        replacesBlockId: block.json().block.id,
      },
      hostCookie,
    );
    expect(replacement.json().block.wizardKey).toBe('checkout_steps');
    expect((await wizard(unitId)).json().fields.checkout_steps.filled).toBe(true);
  });
});

describe('go-live gate', () => {
  it('refuses before approval, then while incomplete, then while translating', async () => {
    const { propertyId, unitId } = await newUnit();
    const early = await goLive(unitId);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'not-approved' });

    expect((await approve(propertyId)).statusCode).toBe(204);
    const incomplete = await goLive(unitId);
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json()).toEqual({ error: 'not-ready' });
    expect((await get(t.app, `/api/host/units/${unitId}`, hostCookie)).json().qrSlug).toBeNull();
    const stay = await post(t.app, `/api/host/units/${unitId}/stays`, STAY, hostCookie);
    expect(stay.json()).toEqual({ error: 'unit-not-live' });
    const qr = await get(t.app, `/api/host/units/${unitId}/qr`, hostCookie);
    expect(qr.statusCode).toBe(409);

    await fillGoLiveMinimum(t.app, hostCookie, { propertyId, unitId });
    const block = await post(
      t.app,
      `/api/host/properties/${propertyId}/blocks`,
      { category: 'how_tos', title: 'Heating', body: 'Remote in the drawer.' },
      hostCookie,
    );
    expect((await wizard(unitId)).json().goLive.missing).toEqual(['translations']);
    expect((await goLive(unitId)).json()).toEqual({ error: 'not-ready' });

    // The test queue runs no jobs; publish the block's revision directly.
    await t.db
      .update(infoBlocks)
      .set({ publishedRevision: sql`${infoBlocks.revision}`, translationStatus: 'published' })
      .where(eq(infoBlocks.id, block.json().block.id));

    const live = await goLive(unitId);
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ live: true, goLive: { ready: true, missing: [] } });
    const detail = (await get(t.app, `/api/host/units/${unitId}`, hostCookie)).json();
    expect(detail.qrSlug).toMatch(/^[a-z2-9]{12}$/);
    expect(detail.live).toBe(true);
    expect((await get(t.app, `/api/host/units/${unitId}/qr`, hostCookie)).statusCode).toBe(200);
    expect(
      (await post(t.app, `/api/host/units/${unitId}/stays`, STAY, hostCookie)).statusCode,
    ).toBe(201);

    // Idempotent: the slug never changes.
    expect((await goLive(unitId)).statusCode).toBe(200);
    expect((await get(t.app, `/api/host/units/${unitId}`, hostCookie)).json().qrSlug).toBe(
      detail.qrSlug,
    );

    // Live is one-way: clearing a required field keeps the unit live.
    await patch(t.app, `/api/host/properties/${propertyId}`, { hostPhone: null }, hostCookie);
    const after = (await wizard(unitId)).json();
    expect(after.live).toBe(true);
    expect(after.goLive.missing).toEqual(['host_phone']);
  });

  it('makes a complete unit live when the property is approved', async () => {
    const ids = await newUnit();
    await fillGoLiveMinimum(t.app, hostCookie, ids);
    expect((await wizard(ids.unitId)).json().goLive.missing).toEqual(['approval']);
    await approve(ids.propertyId);
    expect((await wizard(ids.unitId)).json().live).toBe(true);
  });
});

describe('act-as and ownership', () => {
  it('lets an admin acting as the host run the wizard, audited', async () => {
    const ids = await newUnit();
    await approve(ids.propertyId);
    const [host] = await t.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, 'a@example.test'));
    const acting = await post(t.app, '/api/admin/act-as', { hostId: host?.id }, adminCookie);
    expect(acting.statusCode).toBe(200);
    try {
      expect((await wizard(ids.unitId, adminCookie)).statusCode).toBe(200);
      await fillGoLiveMinimum(t.app, adminCookie, ids);
      expect((await goLive(ids.unitId, adminCookie)).statusCode).toBe(200);
      // The audit hook records route patterns.
      const rows = await t.db.select({ route: actAsAudit.route }).from(actAsAudit);
      const routes = rows.map((r) => r.route);
      expect(routes).toContain('/api/host/units/:id');
      expect(routes).toContain('/api/host/units/:id/go-live');
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
  });

  it("hides another host's wizard and go-live", async () => {
    const { unitId } = await newUnit();
    expect((await wizard(unitId, otherCookie)).statusCode).toBe(404);
    expect((await goLive(unitId, otherCookie)).statusCode).toBe(404);
  });
});

describe('back-office language', () => {
  it('stores the person’s own language', async () => {
    const me = await get(t.app, '/api/auth/me', hostCookie);
    expect(me.json().account.language).toBe('en');
    const set = await put(t.app, '/api/auth/me/language', { language: 'hr' }, hostCookie);
    expect(set.statusCode).toBe(200);
    expect(set.json().account.language).toBe('hr');
    expect((await get(t.app, '/api/auth/me', hostCookie)).json().account.language).toBe('hr');
    const bad = await put(t.app, '/api/auth/me/language', { language: 'es' }, hostCookie);
    expect(bad.statusCode).toBe(400);
  });
});

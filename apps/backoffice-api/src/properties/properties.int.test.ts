import { accounts, actAsAudit, infoBlocks } from '@fetivi/domain';
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
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;

async function idOf(email: string) {
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return row.id;
}

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  await signUpVerifiedHost(t, 'b@example.test');
  hostA = { id: await idOf('a@example.test'), cookie: await loginAs(t, 'a@example.test') };
  hostB = { id: await idOf('b@example.test'), cookie: await loginAs(t, 'b@example.test') };
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
});

async function createProperty(cookie: string, body: object = {}) {
  const r = await post(t.app, '/api/host/properties', { name: 'Villa Mare', ...body }, cookie);
  expect(r.statusCode).toBe(201);
  return r.json();
}

async function createUnit(cookie: string, propertyId: string, name = 'Apartment 1') {
  const r = await post(t.app, `/api/host/properties/${propertyId}/units`, { name }, cookie);
  expect(r.statusCode).toBe(201);
  return r.json();
}

async function createBlock(cookie: string, url: string, body: object = {}) {
  const r = await post(
    t.app,
    url,
    { category: 'how_tos', title: 'Rubbish', body: 'Bins are by the gate.', ...body },
    cookie,
  );
  expect(r.statusCode).toBe(201);
  return r.json();
}

describe('ownership', () => {
  let property: { id: string };
  let unit: { id: string };
  let block: { block: { id: string } };

  beforeAll(async () => {
    property = await createProperty(hostA.cookie);
    unit = await createUnit(hostA.cookie, property.id);
    block = await createBlock(hostA.cookie, `/api/host/properties/${property.id}/blocks`);
  });

  it("gives another host 404 on every route of A's records", async () => {
    const b = hostB.cookie;
    const responses = [
      await get(t.app, `/api/host/properties/${property.id}`, b),
      await patch(t.app, `/api/host/properties/${property.id}`, { name: 'Mine' }, b),
      await put(t.app, `/api/host/properties/${property.id}/amenities`, { amenities: [] }, b),
      await post(t.app, `/api/host/properties/${property.id}/units`, { name: 'X' }, b),
      await post(
        t.app,
        `/api/host/properties/${property.id}/blocks`,
        { category: 'how_tos', title: 'x', body: 'y' },
        b,
      ),
      await get(t.app, `/api/host/units/${unit.id}`, b),
      await patch(t.app, `/api/host/units/${unit.id}`, { name: 'Mine' }, b),
      await put(t.app, `/api/host/units/${unit.id}/amenities`, { amenities: [] }, b),
      await put(t.app, `/api/host/units/${unit.id}/hidden-blocks`, { blockIds: [] }, b),
      await post(
        t.app,
        `/api/host/units/${unit.id}/blocks`,
        { category: 'how_tos', title: 'x', body: 'y' },
        b,
      ),
      await get(t.app, `/api/host/units/${unit.id}/qr`, b),
      await patch(t.app, `/api/host/blocks/${block.block.id}`, { title: 'Mine' }, b),
      await del(t.app, `/api/host/blocks/${block.block.id}`, b),
      await del(t.app, `/api/host/units/${unit.id}`, b),
      await del(t.app, `/api/host/properties/${property.id}`, b),
    ];
    for (const r of responses) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: 'not-found' });
    }
    // Nothing changed.
    const a = await get(t.app, `/api/host/properties/${property.id}`, hostA.cookie);
    expect(a.json()).toMatchObject({ name: 'Villa Mare', units: [{ id: unit.id }] });
    expect(a.json().blocks).toHaveLength(1);
  });

  it("never lists A's properties for B, whatever the query says", async () => {
    const r = await get(t.app, `/api/host/properties?hostId=${hostA.id}`, hostB.cookie);
    expect(r.statusCode).toBe(200);
    expect(r.json().properties.map((p: { id: string }) => p.id)).not.toContain(property.id);
  });

  it('refuses protected keys in a body', async () => {
    for (const body of [{ hostId: hostB.id }, { approvedAt: new Date().toISOString() }]) {
      const r = await patch(t.app, `/api/host/properties/${property.id}`, body, hostA.cookie);
      expect(r.statusCode).toBe(400);
    }
    const create = await post(
      t.app,
      '/api/host/properties',
      { name: 'Smuggled', hostId: hostB.id },
      hostA.cookie,
    );
    expect(create.statusCode).toBe(400);
    const slug = await patch(t.app, `/api/host/units/${unit.id}`, { qrSlug: 'x' }, hostA.cookie);
    expect(slug.statusCode).toBe(400);
    const revision = await patch(
      t.app,
      `/api/host/blocks/${block.block.id}`,
      { revision: 9 },
      hostA.cookie,
    );
    expect(revision.statusCode).toBe(400);
  });

  it("does not let B hide or replace A's property block from B's own unit", async () => {
    const bProperty = await createProperty(hostB.cookie, { name: 'B house' });
    const bUnit = await createUnit(hostB.cookie, bProperty.id);
    const hide = await put(
      t.app,
      `/api/host/units/${bUnit.id}/hidden-blocks`,
      { blockIds: [block.block.id] },
      hostB.cookie,
    );
    expect(hide.statusCode).toBe(400);
    const replace = await post(
      t.app,
      `/api/host/units/${bUnit.id}/blocks`,
      { category: 'how_tos', title: 'x', body: 'y', replacesBlockId: block.block.id },
      hostB.cookie,
    );
    expect(replace.statusCode).toBe(400);
  });

  it('refuses a unit block as the block to replace', async () => {
    const own = await createBlock(hostA.cookie, `/api/host/units/${unit.id}/blocks`);
    const r = await post(
      t.app,
      `/api/host/units/${unit.id}/blocks`,
      { category: 'how_tos', title: 'x', body: 'y', replacesBlockId: own.block.id },
      hostA.cookie,
    );
    expect(r.statusCode).toBe(400);
  });
});

describe('inheritance', () => {
  it('shows property values on the unit until the unit overrides them', async () => {
    const property = await createProperty(hostA.cookie, {
      checkInTime: '15:00',
      petsAllowed: true,
      timezone: 'Europe/Zagreb',
    });
    const unit = await createUnit(hostA.cookie, property.id);
    expect(unit.checkInTime).toBeNull();
    expect(unit.propertyValues.checkInTime).toBe('15:00');
    expect(unit.effective).toMatchObject({
      checkInTime: '15:00',
      petsAllowed: true,
      inherited: { checkInTime: true, petsAllowed: true },
    });

    const r = await patch(
      t.app,
      `/api/host/units/${unit.id}`,
      { checkInTime: '16:00', petsAllowed: false },
      hostA.cookie,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().effective).toMatchObject({
      checkInTime: '16:00',
      petsAllowed: false,
      inherited: { checkInTime: false, petsAllowed: false },
    });

    // Null hands the field back to the property.
    const back = await patch(
      t.app,
      `/api/host/units/${unit.id}`,
      { checkInTime: null },
      hostA.cookie,
    );
    expect(back.json().effective.checkInTime).toBe('15:00');
  });

  it('applies hidden and replaced blocks to the effective unit', async () => {
    const property = await createProperty(hostA.cookie);
    const unit = await createUnit(hostA.cookie, property.id);
    const url = `/api/host/properties/${property.id}/blocks`;
    const keep = await createBlock(hostA.cookie, url, { title: 'Keep' });
    const hide = await createBlock(hostA.cookie, url, { title: 'Hide' });
    const replace = await createBlock(hostA.cookie, url, { title: 'Replace' });

    const hidden = await put(
      t.app,
      `/api/host/units/${unit.id}/hidden-blocks`,
      { blockIds: [hide.block.id] },
      hostA.cookie,
    );
    expect(hidden.json()).toEqual({ hiddenBlockIds: [hide.block.id] });
    await createBlock(hostA.cookie, `/api/host/units/${unit.id}/blocks`, {
      title: 'Replacement',
      replacesBlockId: replace.block.id,
    });

    const detail = (await get(t.app, `/api/host/units/${unit.id}`, hostA.cookie)).json();
    expect(detail.effective.blocks.map((b: { title: string }) => b.title)).toEqual([
      'Keep',
      'Replacement',
    ]);
    expect(detail.propertyBlocks).toHaveLength(3);
    expect(detail.hiddenBlockIds).toEqual([hide.block.id]);
    expect(keep.block.revision).toBe(1);
  });

  it('merges amenities, the unit adding to the property', async () => {
    const property = await createProperty(hostA.cookie);
    const unit = await createUnit(hostA.cookie, property.id);
    const p = await put(
      t.app,
      `/api/host/properties/${property.id}/amenities`,
      { amenities: [{ amenity: 'pool', note: 'Heated' }, { amenity: 'elevator' }] },
      hostA.cookie,
    );
    expect(p.json().amenities).toEqual([
      { amenity: 'elevator', note: null },
      { amenity: 'pool', note: 'Heated' },
    ]);
    await put(
      t.app,
      `/api/host/units/${unit.id}/amenities`,
      { amenities: [{ amenity: 'balcony', note: '<i>Sea</i> view' }] },
      hostA.cookie,
    );
    const detail = (await get(t.app, `/api/host/units/${unit.id}`, hostA.cookie)).json();
    expect(detail.effective.amenities).toEqual([
      { amenity: 'balcony', note: 'Sea view', noteFrom: 'unit' },
      { amenity: 'elevator', note: null, noteFrom: null },
      { amenity: 'pool', note: 'Heated', noteFrom: 'property' },
    ]);
    const duplicate = await put(
      t.app,
      `/api/host/units/${unit.id}/amenities`,
      { amenities: [{ amenity: 'tv' }, { amenity: 'tv' }] },
      hostA.cookie,
    );
    expect(duplicate.statusCode).toBe(400);
  });
});

describe('blocks', () => {
  it('starts at revision 1 and adds one on every successful edit', async () => {
    const property = await createProperty(hostA.cookie);
    const created = await createBlock(hostA.cookie, `/api/host/properties/${property.id}/blocks`);
    expect(created.block.revision).toBe(1);
    const url = `/api/host/blocks/${created.block.id}`;
    await patch(t.app, url, { title: 'Bins' }, hostA.cookie);
    const second = await patch(
      t.app,
      url,
      { body: 'By the gate, collected Mondays.' },
      hostA.cookie,
    );
    expect(second.json().block.revision).toBe(3);
    const failed = await patch(t.app, url, { title: 'x'.repeat(121) }, hostA.cookie);
    expect(failed.statusCode).toBe(400);
    const [row] = await t.db
      .select({ revision: infoBlocks.revision })
      .from(infoBlocks)
      .where(eq(infoBlocks.id, created.block.id));
    expect(row?.revision).toBe(3);
  });

  it('saves a block that looks like it holds a code, with a warning', async () => {
    const property = await createProperty(hostA.cookie);
    const r = await post(
      t.app,
      `/api/host/properties/${property.id}/blocks`,
      { category: 'arrival_access', title: 'Getting in', body: 'Door code 4821' },
      hostA.cookie,
    );
    expect(r.statusCode).toBe(201);
    expect(r.json().warnings[0].kind).toBe('code');
    const clean = await createBlock(hostA.cookie, `/api/host/properties/${property.id}/blocks`);
    expect(clean.warnings).toEqual([]);
  });

  it('strips HTML from bodies but keeps Markdown, and checks category and length', async () => {
    const property = await createProperty(hostA.cookie);
    const url = `/api/host/properties/${property.id}/blocks`;
    const created = await createBlock(hostA.cookie, url, {
      body: '**Bins** by the gate<script>alert(1)</script>\n\n- Glass\n- Paper',
    });
    expect(created.block.body).toBe('**Bins** by the gate\n\n- Glass\n- Paper');
    const bad = [
      { category: 'saved_places', title: 'x', body: 'y' },
      { category: 'how_tos', title: 'x'.repeat(121), body: 'y' },
      { category: 'how_tos', title: 'x', body: '<b></b>' },
    ];
    for (const body of bad) {
      expect((await post(t.app, url, body, hostA.cookie)).statusCode).toBe(400);
    }
  });

  it('derives visibility from the Guide section and refuses it in a body', async () => {
    const property = await createProperty(hostA.cookie);
    const url = `/api/host/properties/${property.id}/blocks`;
    const howTo = await createBlock(hostA.cookie, url);
    expect(howTo.block.visibility).toBe('always');
    const arrival = await createBlock(hostA.cookie, url, { category: 'arrival_access' });
    expect(arrival.block.visibility).toBe('after_release');

    const blockUrl = `/api/host/blocks/${howTo.block.id}`;
    const moved = await patch(t.app, blockUrl, { category: 'arrival_access' }, hostA.cookie);
    expect(moved.json().block.visibility).toBe('after_release');
    const back = await patch(t.app, blockUrl, { category: 'contacts_emergency' }, hostA.cookie);
    expect(back.json().block.visibility).toBe('always');

    const body = { category: 'how_tos', title: 'x', body: 'y', visibility: 'after_release' };
    expect((await post(t.app, url, body, hostA.cookie)).statusCode).toBe(400);
    expect((await patch(t.app, blockUrl, { visibility: 'always' }, hostA.cookie)).statusCode).toBe(
      400,
    );
  });

  it('gives a replacing unit block the visibility of its own section', async () => {
    const property = await createProperty(hostA.cookie);
    const shared = await createBlock(hostA.cookie, `/api/host/properties/${property.id}/blocks`, {
      category: 'arrival_access',
    });
    const unit = await post(
      t.app,
      `/api/host/properties/${property.id}/units`,
      { name: 'A2' },
      hostA.cookie,
    );
    const replacement = await createBlock(
      hostA.cookie,
      `/api/host/units/${unit.json().id}/blocks`,
      {
        category: 'how_tos',
        replacesBlockId: shared.block.id,
      },
    );
    expect(replacement.block.visibility).toBe('always');
  });

  it('deletes a block', async () => {
    const property = await createProperty(hostA.cookie);
    const created = await createBlock(hostA.cookie, `/api/host/properties/${property.id}/blocks`);
    const r = await del(t.app, `/api/host/blocks/${created.block.id}`, hostA.cookie);
    expect(r.statusCode).toBe(204);
    const detail = await get(t.app, `/api/host/properties/${property.id}`, hostA.cookie);
    expect(detail.json().blocks).toEqual([]);
  });
});

describe('input', () => {
  it('strips markup and turns empty strings into null', async () => {
    const property = await createProperty(hostA.cookie, {
      name: '<b>Villa</b> Mare',
      city: '   ',
      accessInstructions: 'Gate on the left.\r\nThen up the stairs.',
      location: { lat: 43.517, lng: 16.2514 },
    });
    expect(property).toMatchObject({
      name: 'Villa Mare',
      city: null,
      accessInstructions: 'Gate on the left.\nThen up the stairs.',
      location: { lat: 43.517, lng: 16.2514 },
      country: 'HR',
      timezone: 'Europe/Zagreb',
      approved: false,
    });
    const cleared = await patch(
      t.app,
      `/api/host/properties/${property.id}`,
      { location: null, accessInstructions: '' },
      hostA.cookie,
    );
    expect(cleared.json()).toMatchObject({ location: null, accessInstructions: null });
  });

  it('validates times, phones, zones and coordinates', async () => {
    const property = await createProperty(hostA.cookie);
    const url = `/api/host/properties/${property.id}`;
    const bad = [
      { checkInTime: '25:00' },
      { hostPhone: 'call me' },
      { timezone: 'Mars/Base' },
      { timezone: '+01:00' },
      { timezone: 'EST' },
      { timezone: 'europe/zagreb' },
      { location: { lat: 91, lng: 0 } },
      { name: '' },
      { name: 'x'.repeat(121) },
      { checkInMethod: 'teleport' },
    ];
    for (const body of bad) {
      expect((await patch(t.app, url, body, hostA.cookie)).statusCode).toBe(400);
    }
    const ok = await patch(
      t.app,
      url,
      { checkInTime: '15:00', hostPhone: '+385 91 234 5678', checkInMethod: 'keypad' },
      hostA.cookie,
    );
    expect(ok.json()).toMatchObject({ checkInTime: '15:00', hostPhone: '+385 91 234 5678' });
    for (const timezone of ['Europe/Rome', 'America/Argentina/Salta', 'Etc/GMT-1']) {
      expect((await patch(t.app, url, { timezone }, hostA.cookie)).json()).toMatchObject({
        timezone,
      });
    }
  });

  it('defaults the arrival release to 1 day and accepts 0 to 7', async () => {
    const property = await createProperty(hostA.cookie);
    const unit = await createUnit(hostA.cookie, property.id);
    expect(unit.arrivalReleaseDaysBefore).toBe(1);
    const url = `/api/host/units/${unit.id}`;
    for (const days of [0, 7]) {
      const r = await patch(t.app, url, { arrivalReleaseDaysBefore: days }, hostA.cookie);
      expect(r.json().arrivalReleaseDaysBefore).toBe(days);
    }
    expect(
      (await patch(t.app, url, { arrivalReleaseDaysBefore: 8 }, hostA.cookie)).statusCode,
    ).toBe(400);
  });

  it('stores unit Wi-Fi, secrets, capacity and beds', async () => {
    const property = await createProperty(hostA.cookie);
    const unit = await createUnit(hostA.cookie, property.id);
    const r = await patch(
      t.app,
      `/api/host/units/${unit.id}`,
      {
        wifiNetwork: 'Mare',
        wifiPassword: 'sunset2024',
        doorCode: '4821',
        maxOccupancy: 4,
        bedrooms: 2,
        bathrooms: 1,
        beds: [
          { type: 'double', count: 1 },
          { type: 'single', count: 2 },
        ],
      },
      hostA.cookie,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      wifiNetwork: 'Mare',
      wifiPassword: 'sunset2024',
      doorCode: '4821',
      maxOccupancy: 4,
      beds: [
        { type: 'double', count: 1 },
        { type: 'single', count: 2 },
      ],
    });
    const tooMany = await patch(
      t.app,
      `/api/host/units/${unit.id}`,
      { maxOccupancy: 0 },
      hostA.cookie,
    );
    expect(tooMany.statusCode).toBe(400);
  });

  it('deletes a property with its units', async () => {
    const property = await createProperty(hostA.cookie);
    const unit = await createUnit(hostA.cookie, property.id);
    expect((await del(t.app, `/api/host/properties/${property.id}`, hostA.cookie)).statusCode).toBe(
      204,
    );
    expect((await get(t.app, `/api/host/units/${unit.id}`, hostA.cookie)).statusCode).toBe(404);
  });
});

describe('act as host', () => {
  it("lets an acting admin edit the host's property, audited", async () => {
    const property = await createProperty(hostA.cookie);
    const refused = await get(t.app, '/api/host/properties', adminCookie);
    expect(refused.statusCode).toBe(403);

    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    const r = await patch(
      t.app,
      `/api/host/properties/${property.id}`,
      { city: 'Trogir' },
      adminCookie,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().city).toBe('Trogir');
    await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);

    const rows = await t.db
      .select()
      .from(actAsAudit)
      .where(eq(actAsAudit.route, '/api/host/properties/:id'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hostId: hostA.id, method: 'PATCH', statusCode: 200 });
  });
});

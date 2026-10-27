import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
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

let t: TestApp;
let hostCookie: string;
let adminCookie: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  hostCookie = await loginAs(t, 'a@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
});

const unitOf = async (id: string) => (await get(t.app, `/api/host/units/${id}`, hostCookie)).json();

describe('property approval', () => {
  let propertyId: string;
  let unitIds: string[];
  let incompleteId: string;

  beforeAll(async () => {
    const property = await post(
      t.app,
      '/api/host/properties',
      { name: 'Villa Mare', city: 'Trogir' },
      hostCookie,
    );
    propertyId = property.json().id;
    unitIds = [];
    for (const name of ['Apartment 1', 'Apartment 2']) {
      const unit = await post(
        t.app,
        `/api/host/properties/${propertyId}/units`,
        { name },
        hostCookie,
      );
      unitIds.push(unit.json().id);
    }
    // Only the first two meet the go-live minimum; the third stays incomplete.
    for (const unitId of unitIds)
      await fillGoLiveMinimum(t.app, hostCookie, { propertyId, unitId });
    const incomplete = await post(
      t.app,
      `/api/host/properties/${propertyId}/units`,
      { name: 'Apartment 9' },
      hostCookie,
    );
    incompleteId = incomplete.json().id;
  });

  it('keeps hosts out of the approval routes', async () => {
    expect((await get(t.app, '/api/admin/properties', hostCookie)).statusCode).toBe(403);
    const r = await post(
      t.app,
      `/api/admin/properties/${propertyId}/approve`,
      undefined,
      hostCookie,
    );
    expect(r.statusCode).toBe(403);
  });

  it('issues no slug and no QR code before approval', async () => {
    const unit = await unitOf(unitIds[0] ?? '');
    expect(unit).toMatchObject({ qrSlug: null, qrLink: null, approved: false });
    const qr = await get(t.app, `/api/host/units/${unitIds[0]}/qr`, hostCookie);
    expect(qr.statusCode).toBe(409);
    expect(qr.json()).toEqual({ error: 'unit-not-live' });
  });

  it('lists the pending property with its host', async () => {
    const r = await get(t.app, '/api/admin/properties', adminCookie);
    expect(r.json().properties).toEqual([
      expect.objectContaining({
        id: propertyId,
        name: 'Villa Mare',
        city: 'Trogir',
        hostEmail: 'a@example.test',
        unitCount: 3,
        readyUnitCount: 2,
        approvedAt: null,
      }),
    ]);
    const approved = await get(t.app, '/api/admin/properties?status=approved', adminCookie);
    expect(approved.json().properties).toEqual([]);
    const all = await get(t.app, '/api/admin/properties?status=all', adminCookie);
    expect(all.json().properties.map((p: { id: string }) => p.id)).toEqual([propertyId]);
  });

  it('approves once, giving every ready unit a permanent slug', async () => {
    const r = await post(
      t.app,
      `/api/admin/properties/${propertyId}/approve`,
      undefined,
      adminCookie,
    );
    expect(r.statusCode).toBe(204);

    const units = await Promise.all(unitIds.map(unitOf));
    for (const unit of units) {
      expect(unit.qrSlug).toMatch(/^[a-z2-9]{12}$/);
      expect(unit.qrLink).toBe(`${GUEST_TEST_ORIGIN}/u/${unit.qrSlug}`);
      expect(unit.approved).toBe(true);
    }
    expect(units[0].qrSlug).not.toBe(units[1].qrSlug);
    // A unit below the go-live minimum is approved but not live.
    expect(await unitOf(incompleteId)).toMatchObject({ approved: true, live: false, qrSlug: null });

    const list = await get(t.app, '/api/admin/properties?status=approved', adminCookie);
    const approvedAt = list.json().properties[0].approvedAt;
    // The live units still count as ready once they have their slugs.
    expect(list.json().properties[0].readyUnitCount).toBe(2);
    expect(approvedAt).toBe('2026-10-19T10:00:00.000Z');

    // Approving again changes nothing.
    t.clock.advance(60_000);
    await post(t.app, `/api/admin/properties/${propertyId}/approve`, undefined, adminCookie);
    const again = await get(t.app, '/api/admin/properties?status=approved', adminCookie);
    expect(again.json().properties[0].approvedAt).toBe(approvedAt);
    expect((await unitOf(unitIds[0] ?? '')).qrSlug).toBe(units[0].qrSlug);

    // Edits never move a slug.
    await patch(t.app, `/api/host/units/${unitIds[0]}`, { name: 'Studio' }, hostCookie);
    expect((await unitOf(unitIds[0] ?? '')).qrSlug).toBe(units[0].qrSlug);
  });

  it('gives a unit created after approval no slug until it goes live', async () => {
    const r = await post(
      t.app,
      `/api/host/properties/${propertyId}/units`,
      { name: 'Apartment 3' },
      hostCookie,
    );
    expect(r.json()).toMatchObject({ qrSlug: null, live: false, approved: true });
  });

  it('serves the QR code as SVG and PNG downloads', async () => {
    const svg = await get(t.app, `/api/host/units/${unitIds[1]}/qr?format=svg`, hostCookie);
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toMatch(/^<(\?xml|svg)/);
    expect(svg.headers['content-disposition']).toBe(
      'attachment; filename="fetivi-apartment-2-qr.svg"',
    );

    const png = await get(t.app, `/api/host/units/${unitIds[1]}/qr?format=png`, hostCookie);
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect([...png.rawPayload.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('answers 404 for an unknown property', async () => {
    const r = await post(
      t.app,
      '/api/admin/properties/00000000-0000-0000-0000-000000000000/approve',
      undefined,
      adminCookie,
    );
    expect(r.statusCode).toBe(404);
  });
});

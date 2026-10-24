import { fieldTexts, QUEUES, uuidFrom } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  get,
  loginAs,
  patch,
  post,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

// Ticket 50: the host's free-text fields are translated on save, with a retry for failures.

let t: TestApp;
let hostA: string;
let hostB: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  await signUpVerifiedHost(t, 'b@example.test');
  hostA = await loginAs(t, 'a@example.test');
  hostB = await loginAs(t, 'b@example.test');
});

afterAll(async () => {
  await t?.close();
});

interface FieldTranslation {
  id: string;
  field: string | null;
  amenity: string | null;
  status: string;
  error: string | null;
}

async function newUnit(cookie = hostA) {
  const p = await post(t.app, '/api/host/properties', { name: 'Villa' }, cookie);
  const propertyId = p.json().id as string;
  const u = await post(t.app, `/api/host/properties/${propertyId}/units`, { name: 'A1' }, cookie);
  return { propertyId, unitId: u.json().id as string };
}

const jobsFor = async (fieldTextId: string) =>
  (
    await t.boss.findJobs<{ fieldTextId: string; revision: number }>(QUEUES.translateFieldText)
  ).filter((j) => j.data.fieldTextId === fieldTextId);

const setFailed = (id: string) =>
  t.db
    .update(fieldTexts)
    .set({ translationStatus: 'failed', translationError: 'model-error' })
    .where(eq(fieldTexts.id, id));

describe('field translation on save', () => {
  it('enqueues one job when a property field is saved, and none for the same text', async () => {
    const { propertyId } = await newUnit();
    const url = `/api/host/properties/${propertyId}`;
    const r = await patch(t.app, url, { accessInstructions: 'Uđite kroz plava vrata.' }, hostA);
    expect(r.statusCode).toBe(200);
    const [ft] = r.json().fieldTranslations as FieldTranslation[];
    expect(ft).toMatchObject({
      field: 'accessInstructions',
      amenity: null,
      status: 'pending',
      error: null,
    });
    const jobs = await jobsFor(ft?.id ?? '');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(uuidFrom(`field-text:${ft?.id}:1`));
    expect(jobs[0]?.data).toEqual({ fieldTextId: ft?.id, revision: 1 });

    // The same text, or another field changing, sends no new job for this field.
    await patch(t.app, url, { accessInstructions: 'Uđite kroz plava vrata.' }, hostA);
    await patch(t.app, url, { checkInTime: '15:00' }, hostA);
    expect(await jobsFor(ft?.id ?? '')).toHaveLength(1);

    // An edit moves the revision.
    await patch(t.app, url, { accessInstructions: 'Uđite kroz zelena vrata.' }, hostA);
    expect((await jobsFor(ft?.id ?? '')).map((j) => j.data.revision).sort()).toEqual([1, 2]);

    // Clearing the field drops its field text.
    const cleared = await patch(t.app, url, { accessInstructions: null }, hostA);
    expect(cleared.json().fieldTranslations).toEqual([]);
  });

  it('enqueues on property create', async () => {
    const r = await post(
      t.app,
      '/api/host/properties',
      { name: 'Kuća', parkingNotes: 'Parkirajte iza kuće.' },
      hostA,
    );
    expect(r.statusCode).toBe(201);
    const [ft] = r.json().fieldTranslations as FieldTranslation[];
    expect(ft).toMatchObject({ field: 'parkingNotes', status: 'pending' });
    expect(await jobsFor(ft?.id ?? '')).toHaveLength(1);
  });

  it('gives a unit override its own field text, shown only on the unit', async () => {
    const { propertyId, unitId } = await newUnit();
    await patch(t.app, `/api/host/properties/${propertyId}`, { houseRulesNotes: 'Mir.' }, hostA);
    const r = await patch(
      t.app,
      `/api/host/units/${unitId}`,
      { houseRulesNotes: 'Tišina.' },
      hostA,
    );
    expect(r.statusCode).toBe(200);
    const unitTexts = r.json().fieldTranslations as FieldTranslation[];
    expect(unitTexts).toHaveLength(1);
    const [row] = await t.db
      .select()
      .from(fieldTexts)
      .where(eq(fieldTexts.id, unitTexts[0]?.id ?? ''));
    expect(row).toMatchObject({ unitId, propertyId: null, source: 'Tišina.' });
    const property = (await get(t.app, `/api/host/properties/${propertyId}`, hostA)).json();
    expect(property.fieldTranslations).toHaveLength(1);
    expect(property.fieldTranslations[0].id).not.toBe(unitTexts[0]?.id);

    // Back to inheriting: the unit's own row goes.
    const back = await patch(t.app, `/api/host/units/${unitId}`, { houseRulesNotes: null }, hostA);
    expect(back.json().fieldTranslations).toEqual([]);
  });

  it('enqueues for amenity notes on property and unit, and drops removed ones', async () => {
    const { propertyId, unitId } = await newUnit();
    const r = await put(
      t.app,
      `/api/host/properties/${propertyId}/amenities`,
      { amenities: [{ amenity: 'pool', note: 'Grijani' }, { amenity: 'elevator' }] },
      hostA,
    );
    expect(r.statusCode).toBe(200);
    let property = (await get(t.app, `/api/host/properties/${propertyId}`, hostA)).json();
    const [note] = property.fieldTranslations as FieldTranslation[];
    expect(note).toMatchObject({ field: null, amenity: 'pool', status: 'pending' });
    expect(await jobsFor(note?.id ?? '')).toHaveLength(1);

    await put(
      t.app,
      `/api/host/units/${unitId}/amenities`,
      { amenities: [{ amenity: 'ac', note: 'Samo u spavaćoj sobi' }] },
      hostA,
    );
    const unit = (await get(t.app, `/api/host/units/${unitId}`, hostA)).json();
    expect(unit.fieldTranslations).toEqual([
      expect.objectContaining({ field: null, amenity: 'ac', status: 'pending' }),
    ]);

    await put(t.app, `/api/host/properties/${propertyId}/amenities`, { amenities: [] }, hostA);
    property = (await get(t.app, `/api/host/properties/${propertyId}`, hostA)).json();
    expect(property.fieldTranslations).toEqual([]);
  });
});

describe('field translation retry', () => {
  it('retries a failed field text with a fresh job', async () => {
    const { propertyId } = await newUnit();
    const r = await patch(
      t.app,
      `/api/host/properties/${propertyId}`,
      { parkingNotes: 'Garaža je u dvorištu.' },
      hostA,
    );
    const id = (r.json().fieldTranslations as FieldTranslation[])[0]?.id ?? '';
    await setFailed(id);
    const failed = (await get(t.app, `/api/host/properties/${propertyId}`, hostA)).json();
    expect(failed.fieldTranslations[0]).toMatchObject({ status: 'failed', error: 'model-error' });

    const retry = await post(t.app, `/api/host/field-texts/${id}/translations/retry`, {}, hostA);
    expect([retry.statusCode, retry.json()]).toEqual([200, { ok: true }]);
    const after = (await get(t.app, `/api/host/properties/${propertyId}`, hostA)).json();
    expect(after.fieldTranslations[0]).toMatchObject({ status: 'pending', error: null });
    expect(await jobsFor(id)).toHaveLength(2);
  });

  it('refuses a field text that has not failed with 409', async () => {
    const { propertyId } = await newUnit();
    const r = await patch(
      t.app,
      `/api/host/properties/${propertyId}`,
      { parkingNotes: 'Ulica.' },
      hostA,
    );
    const id = (r.json().fieldTranslations as FieldTranslation[])[0]?.id ?? '';
    const retry = await post(t.app, `/api/host/field-texts/${id}/translations/retry`, {}, hostA);
    expect([retry.statusCode, retry.json()]).toEqual([409, { error: 'translation-not-failed' }]);
  });

  it("answers 404 for another host's field text, property- or unit-owned", async () => {
    const { propertyId, unitId } = await newUnit();
    const p = await patch(
      t.app,
      `/api/host/properties/${propertyId}`,
      { parkingNotes: 'A.' },
      hostA,
    );
    const u = await patch(t.app, `/api/host/units/${unitId}`, { parkingNotes: 'B.' }, hostA);
    for (const id of [p.json().fieldTranslations[0].id, u.json().fieldTranslations[0].id]) {
      await setFailed(id);
      const retry = await post(t.app, `/api/host/field-texts/${id}/translations/retry`, {}, hostB);
      expect(retry.statusCode).toBe(404);
      // The owner can retry the unit-owned one too.
      const own = await post(t.app, `/api/host/field-texts/${id}/translations/retry`, {}, hostA);
      expect(own.statusCode).toBe(200);
    }
  });
});

import {
  accounts,
  actAsAudit,
  emptyExtraction,
  infoBlocks,
  loadEffectiveUnit,
  type ManualDraftItem,
  type ManualExtractionData,
  QUEUES,
  SAMPLE_MANUAL,
  sampleExtraction,
} from '@fetivi/domain';
import { minimalDocx, minimalPdf } from '@fetivi/domain/testing';
import { eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  patch,
  post,
  scriptedManualModel,
  signUpVerifiedHost,
  TEST_ORIGIN,
  type TestApp,
} from '../testing';

let t: TestApp;
const model = scriptedManualModel([]);
let hostCookie: string;
let otherCookie: string;
let adminCookie: string;

beforeAll(async () => {
  t = await createTestApp({ manualImportModel: model });
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
  const property = await post(t.app, '/api/host/properties', { name: 'Apartman Mare' }, cookie);
  const propertyId = property.json().id as string;
  const unit = await post(
    t.app,
    `/api/host/properties/${propertyId}/units`,
    { name: 'A1' },
    cookie,
  );
  return { propertyId, unitId: unit.json().id as string };
}

const base = (unitId: string) => `/api/host/units/${unitId}/manual-import`;

/** Pastes `text` with the model scripted to return `output`. */
async function importWith(
  unitId: string,
  output: ManualExtractionData = sampleExtraction(),
  cookie = hostCookie,
  text = SAMPLE_MANUAL,
) {
  model.push({ ok: true, output });
  return post(t.app, base(unitId), { text }, cookie);
}

function upload(unitId: string, payload: Uint8Array | string, contentType: string) {
  return t.app.inject({
    method: 'POST',
    url: base(unitId),
    headers: { 'content-type': contentType, origin: TEST_ORIGIN, cookie: hostCookie },
    payload: typeof payload === 'string' ? payload : Buffer.from(payload),
  });
}

const confirm = (unitId: string, itemId: string, body: unknown, cookie = hostCookie) =>
  post(t.app, `${base(unitId)}/items/${itemId}/confirm`, body, cookie);
const dismiss = (unitId: string, itemId: string, cookie = hostCookie) =>
  post(t.app, `${base(unitId)}/items/${itemId}/dismiss`, undefined, cookie);

type Items = ManualDraftItem[];
const findField = (items: Items, fieldId: string) =>
  items.find((i) => i.kind === 'field' && i.fieldId === fieldId) as
    | Extract<ManualDraftItem, { kind: 'field' }>
    | undefined;
const findBlock = (items: Items, title: string) =>
  items.find((i) => i.kind === 'block' && i.title === title) as
    | Extract<ManualDraftItem, { kind: 'block' }>
    | undefined;

const unitOf = async (unitId: string) =>
  (await get(t.app, `/api/host/units/${unitId}`, hostCookie)).json();
const blocksOf = (ids: { propertyId: string; unitId: string }) =>
  t.db
    .select()
    .from(infoBlocks)
    .where(or(eq(infoBlocks.propertyId, ids.propertyId), eq(infoBlocks.unitId, ids.unitId)));
const jobsFor = async (blockId: string) =>
  (await t.boss.findJobs<{ blockId: string; revision: number }>(QUEUES.translateBlock)).filter(
    (j) => j.data.blockId === blockId,
  );

describe('importing a manual', () => {
  it('turns pasted text into drafts without changing anything', async () => {
    const ids = await newUnit();
    const r = await importWith(
      ids.unitId,
      sampleExtraction(),
      hostCookie,
      `${SAMPLE_MANUAL}\n<b>bold</b>`,
    );
    expect(r.statusCode).toBe(201);
    expect(model.calls.at(-1)).toContain('Apartman Mare');
    expect(model.calls.at(-1)).not.toContain('<b>');
    const items: Items = r.json().import.items;
    expect(r.json().import.source).toBe('paste');
    expect(new Set(items.map((i) => i.kind))).toEqual(
      new Set(['field', 'amenities', 'block', 'unmapped']),
    );
    expect(items.every((i) => i.status === 'pending')).toBe(true);

    const unit = await unitOf(ids.unitId);
    expect(unit.effective.checkInTime).toBeNull();
    expect(unit.wifiPassword).toBeNull();
    expect(await blocksOf(ids)).toEqual([]);
    expect((await get(t.app, base(ids.unitId), hostCookie)).json().import.id).toBe(
      r.json().import.id,
    );
  });

  it('reads TXT, DOCX and PDF uploads', async () => {
    const { unitId } = await newUnit();
    model.push({ ok: true, output: sampleExtraction() });
    const txt = await upload(unitId, 'Check-in from 15:00.', 'text/plain');
    expect(txt.statusCode).toBe(201);
    expect(txt.json().import.source).toBe('txt');

    model.push({ ok: true, output: sampleExtraction() });
    const docx = await upload(
      unitId,
      await minimalDocx(['Checkout by 10:00.', 'No parties.']),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(docx.statusCode).toBe(201);
    expect(docx.json().import.source).toBe('docx');
    expect(model.calls.at(-1)).toContain('No parties.');

    model.push({ ok: true, output: sampleExtraction() });
    const pdf = await upload(unitId, minimalPdf('Quiet hours from 22:00'), 'application/pdf');
    expect(pdf.statusCode).toBe(201);
    expect(pdf.json().import.source).toBe('pdf');
    expect(model.calls.at(-1)).toContain('Quiet hours from 22:00');
  });

  it('refuses files it cannot read, with a reason', async () => {
    const { unitId } = await newUnit();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const asPdf = await upload(unitId, png, 'application/pdf');
    expect([asPdf.statusCode, asPdf.json()]).toEqual([415, { error: 'unsupported-manual' }]);
    const asPng = await upload(unitId, png, 'image/png');
    expect([asPng.statusCode, asPng.json()]).toEqual([415, { error: 'unsupported-manual' }]);
    const docxAsText = await upload(unitId, await minimalDocx(['x']), 'text/plain');
    expect(docxAsText.statusCode).toBe(415);

    const big = await upload(unitId, new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61), 'text/plain');
    expect([big.statusCode, big.json()]).toEqual([413, { error: 'manual-too-large' }]);

    const blank = await post(t.app, base(unitId), { text: '  \n\n ' }, hostCookie);
    expect([blank.statusCode, blank.json()]).toEqual([422, { error: 'manual-empty' }]);
    const long = await post(t.app, base(unitId), { text: 'a'.repeat(60_001) }, hostCookie);
    expect([long.statusCode, long.json()]).toEqual([413, { error: 'manual-too-long' }]);
  });

  it('keeps the previous import when the model fails', async () => {
    const { unitId } = await newUnit();
    const first = await importWith(unitId);
    model.push({ ok: false, error: 'model-error', detail: '529 overloaded' });
    const failed = await post(t.app, base(unitId), { text: SAMPLE_MANUAL }, hostCookie);
    expect([failed.statusCode, failed.json()]).toEqual([502, { error: 'import-failed' }]);
    expect((await get(t.app, base(unitId), hostCookie)).json().import.id).toBe(
      first.json().import.id,
    );
  });

  it('answers 503 when no model is configured', async () => {
    const { unitId } = await newUnit();
    model.push({ ok: false, error: 'not-configured', detail: 'ANTHROPIC_API_KEY is not set' });
    const r = await post(t.app, base(unitId), { text: 'Hello' }, hostCookie);
    expect([r.statusCode, r.json()]).toEqual([503, { error: 'import-not-configured' }]);
  });
});

describe('confirming drafts', () => {
  it('writes a core field to the property, or to the unit that overrides it', async () => {
    const ids = await newUnit();
    let items: Items = (await importWith(ids.unitId)).json().import.items;
    const checkIn = findField(items, 'check_in_time');
    expect(checkIn?.values).toEqual({ checkInTime: '15:00' });
    const r = await confirm(ids.unitId, checkIn?.id ?? '', { values: checkIn?.values });
    expect(r.statusCode).toBe(200);
    const property = (
      await get(t.app, `/api/host/properties/${ids.propertyId}`, hostCookie)
    ).json();
    expect(property.checkInTime).toBe('15:00');
    expect(findField(r.json().import.items, 'check_in_time')?.status).toBe('confirmed');

    // The unit overrides the checkout time: the confirm writes the unit, with the edited value.
    await patch(t.app, `/api/host/units/${ids.unitId}`, { checkoutTime: '09:00' }, hostCookie);
    items = (await importWith(ids.unitId)).json().import.items;
    const checkout = findField(items, 'checkout_time');
    expect(
      (await confirm(ids.unitId, checkout?.id ?? '', { values: { checkoutTime: '10:30' } }))
        .statusCode,
    ).toBe(200);
    const unit = await unitOf(ids.unitId);
    expect(unit.checkoutTime).toBe('10:30');
    expect(unit.propertyValues.checkoutTime).toBeNull();

    const again = await confirm(ids.unitId, checkout?.id ?? '', {
      values: { checkoutTime: '10:30' },
    });
    expect([again.statusCode, again.json()]).toEqual([409, { error: 'draft-resolved' }]);
  });

  it('rejects an invalid edited value and keeps the draft pending', async () => {
    const ids = await newUnit();
    const items: Items = (await importWith(ids.unitId)).json().import.items;
    const checkIn = findField(items, 'check_in_time');
    const r = await confirm(ids.unitId, checkIn?.id ?? '', { values: { checkInTime: '3 pm' } });
    expect(r.statusCode).toBe(400);
    const wrongColumn = await confirm(ids.unitId, checkIn?.id ?? '', {
      values: { checkoutTime: '10:00' },
    });
    expect(wrongColumn.statusCode).toBe(400);
    const now = (await get(t.app, base(ids.unitId), hostCookie)).json().import.items as Items;
    expect(findField(now, 'check_in_time')?.status).toBe('pending');
  });

  it('puts secrets in typed fields and never in block text', async () => {
    const ids = await newUnit();
    const items: Items = (await importWith(ids.unitId)).json().import.items;
    const wifi = findField(items, 'wifi');
    // noWifi is already false, so only the network and password are proposed.
    expect(wifi?.values).toEqual({
      wifiNetwork: 'MareGuest',
      wifiPassword: 'sunce2024',
    });
    const router = findBlock(items, 'Wi-Fi router');
    expect(router?.scrubbed).toBe(true);
    for (const item of items) {
      if (item.kind === 'block') expect(item.body).not.toContain('sunce2024');
    }

    await confirm(ids.unitId, wifi?.id ?? '', { values: wifi?.values });
    expect((await unitOf(ids.unitId)).wifiPassword).toBe('sunce2024');
    const r = await confirm(ids.unitId, router?.id ?? '', {
      title: router?.title,
      body: router?.body,
    });
    expect(r.statusCode).toBe(200);
    const [block] = (await blocksOf(ids)).filter((b) => b.title === 'Wi-Fi router');
    expect(block?.body).not.toContain('sunce2024');
  });

  it('creates a block with its translation job, or updates the prompt block it answers', async () => {
    const ids = await newUnit();
    const existing = await post(
      t.app,
      `/api/host/units/${ids.unitId}/blocks`,
      { category: 'how_tos', title: 'AC', body: 'Old text.', wizardKey: 'heating_cooling' },
      hostCookie,
    );
    const existingId = existing.json().block.id as string;
    const items: Items = (await importWith(ids.unitId)).json().import.items;

    const tips = findBlock(items, 'Our tips');
    expect(
      (await confirm(ids.unitId, tips?.id ?? '', { title: 'Our tips', body: tips?.body }))
        .statusCode,
    ).toBe(200);
    const [created] = (await blocksOf(ids)).filter((b) => b.title === 'Our tips');
    expect(created).toMatchObject({
      propertyId: ids.propertyId,
      wizardKey: 'neighbourhood_tips',
      revision: 1,
      translationStatus: 'pending',
      visibility: 'always',
    });
    expect(await jobsFor(created?.id ?? '')).toHaveLength(1);

    const ac = findBlock(items, 'Air conditioning');
    expect(
      (await confirm(ids.unitId, ac?.id ?? '', { title: ac?.title, body: ac?.body })).statusCode,
    ).toBe(200);
    const acBlocks = (await blocksOf(ids)).filter((b) => b.wizardKey === 'heating_cooling');
    expect(acBlocks).toHaveLength(1);
    expect(acBlocks[0]).toMatchObject({ id: existingId, title: 'Air conditioning', revision: 2 });
    expect(await jobsFor(existingId)).toHaveLength(2);

    const arrival = findBlock(items, 'Getting in');
    await confirm(ids.unitId, arrival?.id ?? '', { title: arrival?.title, body: arrival?.body });
    const [arrivalBlock] = (await blocksOf(ids)).filter((b) => b.title === 'Getting in');
    expect(arrivalBlock?.visibility).toBe('after_release');
  });

  it('adds amenities and keeps the note of one already listed', async () => {
    const ids = await newUnit();
    const items: Items = (await importWith(ids.unitId)).json().import.items;
    const amenities = items.find((i) => i.kind === 'amenities');
    if (amenities?.kind !== 'amenities') throw new Error('no amenities draft');
    // Saved meanwhile with a note of the host's own.
    await t.app.inject({
      method: 'PUT',
      url: `/api/host/properties/${ids.propertyId}/amenities`,
      headers: { origin: TEST_ORIGIN, cookie: hostCookie },
      payload: { amenities: [{ amenity: 'ac', note: 'Bedroom only' }] },
    });
    const r = await confirm(ids.unitId, amenities.id, { amenities: amenities.amenities });
    expect(r.statusCode).toBe(200);
    const effective = await loadEffectiveUnit(t.db, ids.unitId);
    expect(effective?.amenities).toEqual(
      expect.arrayContaining([
        { amenity: 'ac', note: 'Bedroom only' },
        { amenity: 'dishwasher', note: null },
        { amenity: 'coffee_maker', note: null },
      ]),
    );
  });

  it('dismisses a draft without writing, and refuses to confirm it after', async () => {
    const ids = await newUnit();
    const items: Items = (await importWith(ids.unitId)).json().import.items;
    const checkIn = findField(items, 'check_in_time');
    const r = await dismiss(ids.unitId, checkIn?.id ?? '');
    expect(r.statusCode).toBe(200);
    expect(findField(r.json().import.items, 'check_in_time')?.status).toBe('dismissed');
    expect((await unitOf(ids.unitId)).effective.checkInTime).toBeNull();
    expect(
      (await confirm(ids.unitId, checkIn?.id ?? '', { values: checkIn?.values })).statusCode,
    ).toBe(409);
    expect((await dismiss(ids.unitId, 'd999')).statusCode).toBe(404);
  });

  it('places unmapped text as a block in the chosen section', async () => {
    const ids = await newUnit();
    const items: Items = (await importWith(ids.unitId)).json().import.items;
    const cat = items.find((i) => i.kind === 'unmapped');
    if (cat?.kind !== 'unmapped') throw new Error('no unmapped draft');
    expect(cat.text).toContain('Mici');
    const r = await confirm(ids.unitId, cat.id, {
      category: 'house_rules_checkout',
      title: 'Our cat',
      body: cat.text,
    });
    expect(r.statusCode).toBe(200);
    const [block] = (await blocksOf(ids)).filter((b) => b.title === 'Our cat');
    expect(block).toMatchObject({ category: 'house_rules_checkout', wizardKey: null });
    expect(await jobsFor(block?.id ?? '')).toHaveLength(1);
  });

  it('replaces the previous import and keeps what was confirmed from it', async () => {
    const ids = await newUnit();
    const first = (await importWith(ids.unitId)).json().import;
    const checkIn = findField(first.items, 'check_in_time');
    await confirm(ids.unitId, checkIn?.id ?? '', { values: checkIn?.values });
    const extraction = emptyExtraction();
    extraction.fields.checkInTime = '15:00';
    extraction.fields.checkoutTime = '11:00';
    const second = (await importWith(ids.unitId, extraction)).json().import;
    expect(second.id).not.toBe(first.id);
    // The confirmed check-in equals the saved value now, so only the checkout is proposed.
    expect(second.items.map((i: ManualDraftItem) => i.kind === 'field' && i.fieldId)).toEqual([
      'checkout_time',
    ]);
    expect((await unitOf(ids.unitId)).effective.checkInTime).toBe('15:00');
  });
});

describe('ownership, act-as and guests', () => {
  it("hides another host's import on every route", async () => {
    const ids = await newUnit();
    await importWith(ids.unitId);
    expect((await get(t.app, base(ids.unitId), otherCookie)).statusCode).toBe(404);
    expect((await post(t.app, base(ids.unitId), { text: 'x' }, otherCookie)).statusCode).toBe(404);
    expect((await confirm(ids.unitId, 'd1', {}, otherCookie)).statusCode).toBe(404);
    expect((await dismiss(ids.unitId, 'd1', otherCookie)).statusCode).toBe(404);
  });

  it('lets an admin acting as the host import and confirm, audited', async () => {
    const ids = await newUnit();
    const [host] = await t.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, 'a@example.test'));
    expect(
      (await post(t.app, '/api/admin/act-as', { hostId: host?.id }, adminCookie)).statusCode,
    ).toBe(200);
    try {
      const items: Items = (await importWith(ids.unitId, sampleExtraction(), adminCookie)).json()
        .import.items;
      const checkIn = findField(items, 'check_in_time');
      expect(
        (await confirm(ids.unitId, checkIn?.id ?? '', { values: checkIn?.values }, adminCookie))
          .statusCode,
      ).toBe(200);
      const routes = (await t.db.select({ route: actAsAudit.route }).from(actAsAudit)).map(
        (r) => r.route,
      );
      expect(routes).toContain('/api/host/units/:id/manual-import');
      expect(routes).toContain('/api/host/units/:id/manual-import/items/:itemId/confirm');
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
  });

  it('publishes nothing that is not confirmed', async () => {
    const ids = await newUnit();
    await importWith(ids.unitId);
    const effective = await loadEffectiveUnit(t.db, ids.unitId);
    const text = JSON.stringify(effective);
    for (const value of ['sunce2024', 'MareGuest', '4821#', 'Pantan', 'Ulica Matije Gupca']) {
      expect(text).not.toContain(value);
    }
    expect(effective?.blocks).toEqual([]);
    expect(effective?.amenities).toEqual([]);
  });
});

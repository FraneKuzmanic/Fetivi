import { groupUnassigned, type ImportedRow, upsertSourceRows } from '@fetivi/domain';
import { parseRecorded, seedDestination } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminCookie: string;
let destinationId: string;

const SALDUN = { lat: 43.51046, lng: 16.25093 };
const north = (m: number) => ({ lat: SALDUN.lat + m / 111_195, lng: SALDUN.lng });
const osm = (externalId: string, at: number): ImportedRow => ({
  source: 'osm',
  externalId,
  name: 'Plaža Saldun',
  location: north(at),
  placeCategory: 'beach',
  licence: 'ODbL-1.0',
  sourceUrl: `https://www.openstreetmap.org/${externalId}`,
  data: { tags: { natural: 'beach' } },
});

interface Candidate {
  id: string;
  name: string;
  status: string;
  sources: { id: string; source: string; licence: string; sourceUrl: string | null }[];
  draft: { itemId: string; status: string } | null;
  possibleDuplicates: { id: string; name: string; distanceM: number; score: number }[];
}

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');

  // The recorded bathing-water list, plus two OSM rows for Saldun: one joins its candidate, the
  // other (same source) cannot, so it stays apart as a possible duplicate.
  const now = t.clock.now();
  destinationId = await seedDestination(t.db);
  const rows = [...parseRecorded('bathing_water').rows, osm('way/1', 40), osm('node/2', 60)];
  await upsertSourceRows(t.db, destinationId, rows, now);
  await groupUnassigned(t.db, destinationId, now);
});

afterAll(async () => {
  await t?.close();
});

const base = () => `/api/admin/catalog/destinations/${destinationId}/seeding`;
const overview = async (status = 'new') => {
  const res = await get(t.app, `${base()}?status=${status}`, adminCookie);
  expect(res.statusCode).toBe(200);
  return res.json() as {
    destination: { id: string; name: string; radiusM: number };
    lastImport: { id: string; status: string; startedAt: string; sources: object } | null;
    counts: Record<string, number>;
    matchedRecords: number;
    candidates: Candidate[];
  };
};
const byName = (candidates: Candidate[], name: string) => {
  const found = candidates.filter((c) => c.name === name);
  if (found.length === 0) throw new Error(`no candidate ${name}`);
  return found;
};
const one = (candidates: Candidate[], name: string) => {
  const [c] = byName(candidates, name);
  if (!c) throw new Error(`no candidate ${name}`);
  return c;
};
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('admin seeding', () => {
  it('is for the admin only', async () => {
    expect((await get(t.app, base())).statusCode).toBe(401);
    const routes: [string, unknown][] = [
      [`${base()}/import`, {}],
      [`${base()}/draft`, { candidateIds: [UNKNOWN] }],
      [`/api/admin/seeding/candidates/${UNKNOWN}/dismiss`, {}],
      [`/api/admin/seeding/candidates/${UNKNOWN}/restore`, {}],
      [`/api/admin/seeding/candidates/${UNKNOWN}/merge`, { intoId: UNKNOWN }],
      [`/api/admin/seeding/candidates/${UNKNOWN}/keep-apart`, { otherId: UNKNOWN }],
      [`/api/admin/seeding/sources/${UNKNOWN}/split`, {}],
    ];
    expect((await get(t.app, base(), hostCookie)).statusCode).toBe(403);
    for (const [url, body] of routes) {
      expect((await post(t.app, url, body, hostCookie)).statusCode).toBe(403);
    }
  });

  it('lists new candidates with their sources, licences and possible duplicates', async () => {
    const view = await overview();
    expect(view.destination).toMatchObject({ id: destinationId, radiusM: 15_000 });
    expect(view.lastImport).toBeNull();
    expect(view.counts).toEqual({ new: 12, ticked: 0, dismissed: 0 });
    expect(view.matchedRecords).toBe(0);
    const saldun = byName(view.candidates, 'Saldun');
    const merged = saldun.find((c) => c.sources.length === 2);
    const apart = view.candidates.find((c) => c.name === 'Plaža Saldun');
    if (!merged || !apart) throw new Error('Saldun not grouped as expected');
    expect(merged.sources.map((s) => [s.source, s.licence])).toEqual([
      ['bathing_water', 'CC-BY-4.0'],
      ['osm', 'ODbL-1.0'],
    ]);
    expect(merged.possibleDuplicates).toEqual([
      { id: apart.id, name: 'Plaža Saldun', distanceM: 20, score: 1 },
    ]);
    expect(apart.possibleDuplicates.map((d) => d.id)).toEqual([merged.id]);

    expect((await get(t.app, `${base()}?status=bogus`, adminCookie)).statusCode).toBe(400);
    const unknown = await get(
      t.app,
      `/api/admin/catalog/destinations/${UNKNOWN}/seeding`,
      adminCookie,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('starts one import at a time', async () => {
    const start = await post(t.app, `${base()}/import`, {}, adminCookie);
    expect(start.statusCode).toBe(202);
    const { importId } = start.json();
    expect((await overview()).lastImport).toMatchObject({
      id: importId,
      status: 'running',
      startedAt: t.clock.now().toISOString(),
      sources: {},
    });
    const again = await post(t.app, `${base()}/import`, {}, adminCookie);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'import-running' });
    const job = await t.boss.findJobs('import-open-data', { data: { importId } });
    expect(job).toHaveLength(1);
  });

  it('sends ticked candidates to drafting as waiting drafts with Reject only', async () => {
    const { candidates } = await overview();
    const picked = [one(candidates, 'Tri sestrice'), one(candidates, 'Brigi')];
    const ids = picked.map((c) => c.id);
    const draft = await post(t.app, `${base()}/draft`, { candidateIds: ids }, adminCookie);
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toEqual({ drafted: 2, run: { queued: 2, waiting: 0 } });
    const twice = await post(t.app, `${base()}/draft`, { candidateIds: ids }, adminCookie);
    expect(twice.json()).toEqual({ drafted: 0, run: { queued: 0, waiting: 0 } });

    const ticked = await overview('ticked');
    expect(ticked.counts).toMatchObject({ new: 10, ticked: 2 });
    expect(ticked.candidates.map((c) => [c.name, c.draft?.status])).toEqual([
      ['Brigi', 'open'],
      ['Tri sestrice', 'open'],
    ]);

    const queue = await get(t.app, '/api/admin/curation?kind=draft', adminCookie);
    const items = queue.json().items as {
      id: string;
      record: unknown;
      candidate: { id: string; name: string } | null;
      actions: string[];
    }[];
    expect(items.map((i) => i.candidate?.name).sort()).toEqual(['Brigi', 'Tri sestrice']);
    for (const item of items) {
      expect(item).toMatchObject({ record: null, actions: ['reject'] });
      expect(ids).toContain(item.candidate?.id);
    }
    // ADR 0017 unchanged: a draft with no record cannot be approved.
    const approve = await post(
      t.app,
      `/api/admin/curation/${items[0]?.id}/approve`,
      {},
      adminCookie,
    );
    expect(approve.statusCode).toBe(400);
    expect(approve.json()).toEqual({ error: 'invalid-input' });

    expect(
      (await post(t.app, `${base()}/draft`, { candidateIds: [] }, adminCookie)).statusCode,
    ).toBe(400);
    const missing = await post(t.app, `${base()}/draft`, { candidateIds: [UNKNOWN] }, adminCookie);
    expect(missing.statusCode).toBe(404);
  });

  it('dismisses and restores a candidate', async () => {
    const toc = one((await overview()).candidates, 'Toć');
    const dismiss = `/api/admin/seeding/candidates/${toc.id}/dismiss`;
    expect((await post(t.app, dismiss, {}, adminCookie)).statusCode).toBe(204);
    expect((await post(t.app, dismiss, {}, adminCookie)).statusCode).toBe(409);
    const dismissed = await overview('dismissed');
    expect(dismissed.candidates.map((c) => c.id)).toEqual([toc.id]);
    const drafted = await post(t.app, `${base()}/draft`, { candidateIds: [toc.id] }, adminCookie);
    expect(drafted.statusCode).toBe(409);
    expect(drafted.json()).toEqual({ error: 'invalid-state' });

    const restore = `/api/admin/seeding/candidates/${toc.id}/restore`;
    expect((await post(t.app, restore, {}, adminCookie)).statusCode).toBe(204);
    expect((await overview()).candidates.map((c) => c.id)).toContain(toc.id);
    const unknown = await post(
      t.app,
      `/api/admin/seeding/candidates/${UNKNOWN}/restore`,
      {},
      adminCookie,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('keeps two candidates apart, so they are no longer offered for merge', async () => {
    const { candidates } = await overview();
    const merged = byName(candidates, 'Saldun').find((c) => c.sources.length === 2);
    const apart = one(candidates, 'Plaža Saldun');
    if (!merged) throw new Error('no merged Saldun');
    const keep = await post(
      t.app,
      `/api/admin/seeding/candidates/${merged.id}/keep-apart`,
      { otherId: apart.id },
      adminCookie,
    );
    expect(keep.statusCode).toBe(204);
    const after = await overview();
    expect(after.candidates.find((c) => c.id === merged.id)?.possibleDuplicates).toEqual([]);
    expect(after.candidates.find((c) => c.id === apart.id)?.possibleDuplicates).toEqual([]);
    const self = await post(
      t.app,
      `/api/admin/seeding/candidates/${merged.id}/keep-apart`,
      { otherId: merged.id },
      adminCookie,
    );
    expect(self.statusCode).toBe(400);
  });

  it('splits a source row off, then merges it back', async () => {
    const { candidates } = await overview();
    const merged = byName(candidates, 'Saldun').find((c) => c.sources.length === 2);
    const osmRow = merged?.sources.find((s) => s.source === 'osm');
    if (!merged || !osmRow) throw new Error('no merged Saldun');
    const split = await post(
      t.app,
      `/api/admin/seeding/sources/${osmRow.id}/split`,
      {},
      adminCookie,
    );
    expect(split.statusCode).toBe(200);
    const { candidateId } = split.json();
    expect(candidateId).toEqual(expect.any(String));

    let view = await overview();
    expect(view.candidates.find((c) => c.id === merged.id)?.sources).toHaveLength(1);
    const off = view.candidates.find((c) => c.id === candidateId);
    expect(off?.sources.map((s) => s.id)).toEqual([osmRow.id]);
    // The pair it was split from is kept apart, so it is not offered straight back.
    expect(off?.possibleDuplicates.map((d) => d.id)).not.toContain(merged.id);
    const lone = await post(
      t.app,
      `/api/admin/seeding/sources/${osmRow.id}/split`,
      {},
      adminCookie,
    );
    expect(lone.statusCode).toBe(409);

    const merge = await post(
      t.app,
      `/api/admin/seeding/candidates/${candidateId}/merge`,
      { intoId: merged.id },
      adminCookie,
    );
    expect(merge.statusCode).toBe(200);
    expect(merge.json()).toEqual({ candidateId: merged.id });
    view = await overview();
    expect(view.candidates.find((c) => c.id === merged.id)?.sources).toHaveLength(2);
    expect(view.candidates.map((c) => c.id)).not.toContain(candidateId);

    // A ticked candidate survives a merge with a new one.
    const brigi = one((await overview('ticked')).candidates, 'Brigi');
    const intoTicked = await post(
      t.app,
      `/api/admin/seeding/candidates/${brigi.id}/merge`,
      { intoId: merged.id },
      adminCookie,
    );
    expect(intoTicked.json()).toEqual({ candidateId: brigi.id });
    const both = one((await overview('ticked')).candidates, 'Tri sestrice');
    const bothTicked = await post(
      t.app,
      `/api/admin/seeding/candidates/${both.id}/merge`,
      { intoId: brigi.id },
      adminCookie,
    );
    expect(bothTicked.statusCode).toBe(409);
    const badBody = await post(
      t.app,
      `/api/admin/seeding/candidates/${both.id}/merge`,
      { intoId: 'nope' },
      adminCookie,
    );
    expect(badBody.statusCode).toBe(400);
  });
});

import { createCatalogRecord, enqueueCurationItem } from '@fetivi/domain';
import { noopQueue, seedDestination } from '@fetivi/domain/testing';
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
let recordId: string;
let draftId: string;
let providerId: string;
let clusterId: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');

  const now = t.clock.now();
  destinationId = await seedDestination(t.db);
  const record = await createCatalogRecord(
    t.db,
    noopQueue,
    {
      destinationId,
      kind: 'place',
      title: 'Konoba Old',
      description: 'Old text.',
      placeCategory: 'restaurant',
      location: { x: 16.25, y: 43.51 },
    },
    now,
  );
  recordId = record.id;
  const enqueue = (input: Parameters<typeof enqueueCurationItem>[1]) =>
    enqueueCurationItem(t.db, input, now).then((r) => r.id);
  providerId = await enqueue({
    destinationId,
    payload: { kind: 'host_provider_suggestion', name: 'Kayak Bros', contact: null, note: null },
  });
  draftId = await enqueue({
    destinationId,
    recordId,
    payload: { kind: 'draft', changes: { title: 'Konoba New' } },
  });
  clusterId = await enqueue({
    destinationId,
    payload: {
      kind: 'fallback_topic_cluster',
      topic: 'kayak rental',
      topics: ['kayak rental'],
      places: [],
      count: 3,
      noResults: 1,
      weekStart: '2027-07-05',
    },
  });
});

afterAll(async () => {
  await t?.close();
});

const list = (query = '') => get(t.app, `/api/admin/curation${query}`, adminCookie);

describe('admin curation', () => {
  it('is for the admin only', async () => {
    expect((await get(t.app, '/api/admin/curation')).statusCode).toBe(401);
    expect((await get(t.app, '/api/admin/curation', hostCookie)).statusCode).toBe(403);
    expect(
      (await post(t.app, `/api/admin/curation/${draftId}/approve`, {}, hostCookie)).statusCode,
    ).toBe(403);
  });

  it('lists open items by kind with zero-filled counts', async () => {
    const all = await list();
    expect(all.statusCode).toBe(200);
    // Enqueued at one clock instant, so only the set is fixed.
    expect(
      all
        .json()
        .items.map((i: { id: string }) => i.id)
        .sort(),
    ).toEqual([providerId, draftId, clusterId].sort());
    expect(all.json().counts).toEqual({
      draft: 1,
      refresh_diff: 0,
      guest_flagged: 0,
      host_place_suggestion: 0,
      host_provider_suggestion: 1,
      fallback_topic_cluster: 1,
    });
    const drafts = (await list('?kind=draft')).json();
    expect(drafts.items).toHaveLength(1);
    expect(drafts.items[0]).toMatchObject({
      id: draftId,
      kind: 'draft',
      status: 'open',
      record: { id: recordId, title: 'Konoba Old', verifiedAt: null },
      destination: { id: destinationId },
      actions: ['approve', 'edit', 'reject', 'needs_visit'],
    });
    expect(drafts.counts.host_provider_suggestion).toBe(1);
    const provider = all.json().items.find((i: { id: string }) => i.id === providerId);
    expect(provider.actions).toEqual(['approve', 'reject', 'needs_visit']);
    expect((await list('?status=bogus')).statusCode).toBe(400);
  });

  it('edits only record-bound kinds', async () => {
    const bad = await post(t.app, `/api/admin/curation/${providerId}/edit`, {}, adminCookie);
    expect(bad.statusCode).toBe(400);
    const edit = await post(t.app, `/api/admin/curation/${draftId}/edit`, {}, adminCookie);
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toEqual({ recordId });
  });

  it('approves a draft, verifying its record, once', async () => {
    const approve = await post(t.app, `/api/admin/curation/${draftId}/approve`, {}, adminCookie);
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toMatchObject({ id: draftId, status: 'approved', actions: [] });
    expect(approve.json().reviewedAt).toEqual(expect.any(String));
    const record = await get(t.app, `/api/admin/catalog/records/${recordId}`, adminCookie);
    expect(record.json()).toMatchObject({ title: 'Konoba New' });
    expect(record.json().verifiedAt).toEqual(expect.any(String));

    const again = await post(t.app, `/api/admin/curation/${draftId}/approve`, {}, adminCookie);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'not-reviewable' });
    const unknown = await post(
      t.app,
      '/api/admin/curation/00000000-0000-4000-8000-000000000000/approve',
      {},
      adminCookie,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('rejects into done and parks into needs a visit', async () => {
    const reject = await post(t.app, `/api/admin/curation/${providerId}/reject`, {}, adminCookie);
    expect(reject.statusCode).toBe(204);
    const visit = await post(
      t.app,
      `/api/admin/curation/${clusterId}/needs-visit`,
      {},
      adminCookie,
    );
    expect(visit.statusCode).toBe(204);

    const done = (await list('?status=done')).json();
    expect(done.items.map((i: { id: string }) => i.id).sort()).toEqual(
      [draftId, providerId].sort(),
    );
    const parked = (await list('?status=needs_visit')).json();
    expect(parked.items.map((i: { id: string }) => i.id)).toEqual([clusterId]);
    expect(parked.items[0].actions).toEqual(['approve', 'reject', 'needs_visit']);
    expect((await list()).json().items).toEqual([]);
  });

  it('lists the staleness queue', async () => {
    const other = await createCatalogRecord(
      t.db,
      noopQueue,
      {
        destinationId,
        kind: 'place',
        title: 'Beach Never Checked',
        description: 'Text.',
        placeCategory: 'beach',
        location: { x: 16.25, y: 43.51 },
      },
      t.clock.now(),
    );
    const res = await get(
      t.app,
      `/api/admin/curation/staleness?destinationId=${destinationId}`,
      adminCookie,
    );
    expect(res.statusCode).toBe(200);
    const records = res.json().records as { id: string; staleness: unknown }[];
    expect(records.find((r) => r.id === other.id)).toMatchObject({
      title: 'Beach Never Checked',
      destinationName: expect.any(String),
      recommendations: 0,
      verifiedAt: null,
      staleness: { status: 'never_verified', staleAt: null },
    });
    // Konoba was just verified, so it is far from its budget.
    expect(records.find((r) => r.id === recordId)).toBeUndefined();
    expect((await get(t.app, '/api/admin/curation/staleness', hostCookie)).statusCode).toBe(403);
  });
});

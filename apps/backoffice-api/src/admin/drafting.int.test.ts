import {
  createCatalogRecord,
  groupUnassigned,
  type ImportedRow,
  markVerified,
  upsertSourceRows,
} from '@fetivi/domain';
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

/** Thirty restaurants about 1 km apart, so none group together. */
const rows: ImportedRow[] = Array.from({ length: 30 }, (_, i) => ({
  source: 'osm',
  externalId: `node/${i + 1}`,
  name: `Konoba ${String.fromCharCode(65 + (i % 26))}${i}`,
  location: { lat: 43.4 + i * 0.01, lng: 16.25 },
  placeCategory: 'restaurant',
  licence: 'ODbL-1.0',
  sourceUrl: `https://www.openstreetmap.org/node/${i + 1}`,
  data: { tags: { amenity: 'restaurant', website: `https://konoba-${i}.example/` } },
}));

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  destinationId = await seedDestination(t.db);
  await upsertSourceRows(t.db, destinationId, rows, t.clock.now());
  await groupUnassigned(t.db, destinationId, t.clock.now());
});

afterAll(async () => {
  await t?.close();
});

const base = () => `/api/admin/catalog/destinations/${destinationId}`;
const status = async () => {
  const res = await get(t.app, `${base()}/drafting`, adminCookie);
  expect(res.statusCode).toBe(200);
  return res.json() as {
    waiting: number;
    draft: { id: string; startedAt: string; cap: number; waiting: number; counts: object } | null;
    refresh: { id: string; counts: Record<string, number> } | null;
    refreshDue: number;
  };
};

describe('drafting routes', () => {
  it('are admin only', async () => {
    for (const [method, url] of [
      ['get', `${base()}/drafting`],
      ['post', `${base()}/drafting`],
      ['post', `${base()}/refresh`],
    ] as const) {
      const res =
        method === 'get'
          ? await get(t.app, url, hostCookie)
          : await post(t.app, url, {}, hostCookie);
      expect(res.statusCode).toBe(403);
    }
  });

  it('answers 404 for an unknown destination', async () => {
    const unknown = '/api/admin/catalog/destinations/00000000-0000-4000-8000-000000000000';
    expect((await get(t.app, `${unknown}/drafting`, adminCookie)).statusCode).toBe(404);
    expect((await post(t.app, `${unknown}/drafting`, {}, adminCookie)).statusCode).toBe(404);
    expect((await post(t.app, `${unknown}/refresh`, {}, adminCookie)).statusCode).toBe(404);
  });

  it('drafts 25 of 30 ticked candidates and the waiting 5 on the next run', async () => {
    expect(await status()).toEqual({ waiting: 0, draft: null, refresh: null, refreshDue: 0 });
    const overview = await get(t.app, `${base()}/seeding?status=new`, adminCookie);
    const ids = (overview.json().candidates as { id: string }[]).map((c) => c.id);
    expect(ids).toHaveLength(30);

    const ticked = await post(t.app, `${base()}/seeding/draft`, { candidateIds: ids }, adminCookie);
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json()).toEqual({ drafted: 30, run: { queued: 25, waiting: 5 } });
    expect(await t.boss.findJobs('draft-place')).toHaveLength(25);

    const after = await status();
    expect(after.waiting).toBe(5);
    expect(after.draft).toMatchObject({
      cap: 25,
      waiting: 5,
      startedAt: t.clock.now().toISOString(),
      counts: { queued: 25, drafted: 0 },
    });

    const next = await post(t.app, `${base()}/drafting`, {}, adminCookie);
    expect(next.statusCode).toBe(202);
    expect(next.json()).toMatchObject({ queued: 5, waiting: 0 });
    expect(await t.boss.findJobs('draft-place')).toHaveLength(30);

    const none = await post(t.app, `${base()}/drafting`, {}, adminCookie);
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ runId: null, queued: 0, waiting: 0 });
    expect((await status()).waiting).toBe(0);
  });

  it('starts a refresh of verified places once, and refuses a second while it runs', async () => {
    const now = t.clock.now();
    const record = await createCatalogRecord(
      t.db,
      noopQueue,
      {
        destinationId,
        kind: 'place',
        title: 'Konoba Verified',
        description: 'Text.',
        placeCategory: 'restaurant',
        location: { x: 16.25, y: 43.51 },
        websiteUrl: 'https://verified.example/',
      },
      now,
    );
    await markVerified(t.db, record.id, null, now);
    expect((await status()).refreshDue).toBe(1);

    const first = await post(t.app, `${base()}/refresh`, {}, adminCookie);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ queued: 1, waiting: 0 });
    expect(await t.boss.findJobs('refresh-catalog')).toHaveLength(1);
    expect((await status()).refresh?.counts).toMatchObject({ queued: 1 });

    const second = await post(t.app, `${base()}/refresh`, {}, adminCookie);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'run-running' });
  });
});

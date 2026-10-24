import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../../db/schema/accounts';
import { catalogRecords, placeOpenDataSources } from '../../db/schema/catalog';
import { curationItems } from '../../db/schema/curation';
import { seedingCandidates, seedingKeptApart } from '../../db/schema/seeding';
import { createTestDatabase, noopQueue, seedDestination, type TestDatabase } from '../../testing';
import { createCatalogRecord } from '../store';
import type { LatLng } from './geo';
import {
  candidateNames,
  dismissCandidate,
  draftCandidates,
  groupUnassigned,
  keepApart,
  listCandidates,
  mergeCandidates,
  restoreCandidate,
  splitSourceRow,
  upsertSourceRows,
} from './store';
import type { ImportedRow } from './types';
import type { SeedingSource } from './vocabulary';

const NOW = new Date('2027-05-01T10:00:00Z');
const LATER = new Date('2027-05-02T10:00:00Z');
const SALDUN = { lat: 43.51046, lng: 16.25093 };
const north = (p: LatLng, m: number) => ({ lat: p.lat + m / 111_195, lng: p.lng });

let testDb: TestDatabase;
let adminId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email: 'seeder@example.test', passwordHash: 'x', role: 'admin' })
    .returning();
  if (!admin) throw new Error('no admin');
  adminId = admin.id;
});

afterAll(async () => {
  await testDb?.drop();
});

const imported = (
  source: SeedingSource,
  externalId: string,
  name: string,
  location: LatLng,
): ImportedRow => ({
  source,
  externalId,
  name,
  location,
  placeCategory: 'beach',
  licence: source === 'osm' ? 'ODbL-1.0' : 'CC-BY-4.0',
  sourceUrl: null,
  data: { note: externalId },
});

async function seed(rows: ImportedRow[]) {
  const destinationId = await seedDestination(testDb.db);
  await upsertSourceRows(testDb.db, destinationId, rows, NOW);
  await groupUnassigned(testDb.db, destinationId, NOW);
  return destinationId;
}

const rowsOf = (destinationId: string) =>
  testDb.db
    .select()
    .from(placeOpenDataSources)
    .where(eq(placeOpenDataSources.destinationId, destinationId));

async function candidateOf(destinationId: string, externalId: string) {
  const [row] = await testDb.db
    .select()
    .from(placeOpenDataSources)
    .where(
      and(
        eq(placeOpenDataSources.destinationId, destinationId),
        eq(placeOpenDataSources.externalId, externalId),
      ),
    );
  if (!row?.candidateId) throw new Error(`no candidate for ${externalId}`);
  return row.candidateId;
}

describe('upsertSourceRows', () => {
  it('updates rows in place on re-import', async () => {
    const destinationId = await seedDestination(testDb.db);
    const rows = [
      imported('osm', 'way/1', 'Šaldun', SALDUN),
      imported('osm', 'node/2', 'Brigi', north(SALDUN, 900)),
    ];
    const first = await upsertSourceRows(testDb.db, destinationId, rows, NOW);
    expect(first.unassigned).toHaveLength(2);
    await upsertSourceRows(
      testDb.db,
      destinationId,
      [{ ...imported('osm', 'way/1', 'Plaža Šaldun', SALDUN) }],
      LATER,
    );
    const after = await rowsOf(destinationId);
    expect(after).toHaveLength(2);
    const saldun = after.find((r) => r.externalId === 'way/1');
    expect(saldun?.name).toBe('Plaža Šaldun');
    expect(saldun?.fetchedAt).toEqual(LATER);
    expect(saldun?.location).toEqual({ x: SALDUN.lng, y: SALDUN.lat });
  });
});

describe('groupUnassigned', () => {
  it('groups two sources of one place into one candidate', async () => {
    const destinationId = await seed([
      imported('bathing_water', 'HR-1', 'Saldun', SALDUN),
      imported('osm', 'way/1', 'Plaža Saldun', north(SALDUN, 40)),
      imported('osm', 'node/9', 'Brigi', north(SALDUN, 900)),
    ]);
    const rows = await rowsOf(destinationId);
    const saldun = rows.filter((r) => r.externalId !== 'node/9');
    expect(new Set(saldun.map((r) => r.candidateId)).size).toBe(1);
    expect(rows.find((r) => r.externalId === 'node/9')?.candidateId).not.toBe(
      saldun[0]?.candidateId,
    );
    const overview = await listCandidates(testDb.db, destinationId, 'new');
    expect(overview.counts).toEqual({ new: 2, ticked: 0, dismissed: 0 });
    const candidate = overview.candidates.find((c) => c.name === 'Saldun');
    expect(candidate?.sources.map((s) => [s.source, s.licence])).toEqual([
      ['bathing_water', 'CC-BY-4.0'],
      ['osm', 'ODbL-1.0'],
    ]);
    expect(candidate?.distanceM).toBeGreaterThan(0);
  });

  it('attaches a row to a matching record without touching the record', async () => {
    const destinationId = await seedDestination(testDb.db);
    const trs = { lat: 43.5172, lng: 16.2507 };
    const record = await createCatalogRecord(
      testDb.db,
      noopQueue,
      {
        destinationId,
        kind: 'place',
        title: 'Konoba Trs',
        description: 'Curated text.',
        placeCategory: 'restaurant',
        location: { x: trs.lng, y: trs.lat },
        fieldSources: { title: 'https://example.test/trs' },
      },
      NOW,
    );
    await upsertSourceRows(
      testDb.db,
      destinationId,
      [
        {
          ...imported('osm', 'node/5', 'Restaurant Trs', north(trs, 30)),
          placeCategory: 'restaurant',
        },
      ],
      NOW,
    );
    expect(await groupUnassigned(testDb.db, destinationId, LATER)).toEqual({
      attached: 1,
      joined: 0,
      created: 0,
    });
    const [row] = await rowsOf(destinationId);
    expect(row).toMatchObject({ recordId: record.id, candidateId: null });
    const [after] = await testDb.db
      .select()
      .from(catalogRecords)
      .where(eq(catalogRecords.id, record.id));
    expect(after).toMatchObject({
      title: record.title,
      description: record.description,
      location: record.location,
      revision: record.revision,
      updatedAt: record.updatedAt,
      fieldSources: record.fieldSources,
    });
    expect((await listCandidates(testDb.db, destinationId, 'new')).matchedRecords).toBe(1);

    // A deleted record returns its rows to the pool; the next grouping proposes them.
    await testDb.db.delete(catalogRecords).where(eq(catalogRecords.id, record.id));
    const [released] = await rowsOf(destinationId);
    expect(released).toMatchObject({ recordId: null, candidateId: null });
    expect((await groupUnassigned(testDb.db, destinationId, LATER)).created).toBe(1);
  });

  it('joins a re-imported row of another source to the existing candidate', async () => {
    const destinationId = await seed([imported('osm', 'way/1', 'Šaldun', SALDUN)]);
    const candidateId = await candidateOf(destinationId, 'way/1');
    await upsertSourceRows(
      testDb.db,
      destinationId,
      [imported('bathing_water', 'HR-1', 'Saldun', north(SALDUN, 30))],
      LATER,
    );
    expect(await groupUnassigned(testDb.db, destinationId, LATER)).toMatchObject({ joined: 1 });
    expect(await candidateOf(destinationId, 'HR-1')).toBe(candidateId);
  });
});

describe('draftCandidates', () => {
  it('ticks candidates and queues one draft each, once', async () => {
    const destinationId = await seed([
      imported('osm', 'way/1', 'Šaldun', SALDUN),
      imported('osm', 'node/9', 'Brigi', north(SALDUN, 900)),
    ]);
    const a = await candidateOf(destinationId, 'way/1');
    const b = await candidateOf(destinationId, 'node/9');
    expect(
      await draftCandidates(testDb.db, noopQueue, destinationId, [a, b], adminId, NOW),
    ).toEqual({
      drafted: 2,
      run: { queued: 2, waiting: 0 },
    });
    expect(await draftCandidates(testDb.db, noopQueue, destinationId, [a], adminId, NOW)).toEqual({
      drafted: 0,
      run: { queued: 0, waiting: 0 },
    });
    // A day on, the first run's tasks never ran (no worker here), so they count as lost and the
    // next tick drafts them again.
    expect(await draftCandidates(testDb.db, noopQueue, destinationId, [a], adminId, LATER)).toEqual(
      {
        drafted: 0,
        run: { queued: 2, waiting: 0 },
      },
    );
    const [candidate] = await testDb.db
      .select()
      .from(seedingCandidates)
      .where(eq(seedingCandidates.id, a));
    expect(candidate).toMatchObject({ status: 'ticked', tickedAt: NOW, tickedBy: adminId });
    const items = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.dedupeKey, `seeding-candidate:${a}`));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'draft',
      status: 'open',
      recordId: null,
      destinationId,
      payload: { kind: 'draft', changes: {}, candidateId: a },
    });
    const ticked = await listCandidates(testDb.db, destinationId, 'ticked');
    expect(ticked.candidates.find((c) => c.id === a)?.draft).toEqual({
      itemId: items[0]?.id,
      status: 'open',
    });
    expect((await candidateNames(testDb.db, [a, b])).get(a)).toBe('Šaldun');
  });

  it('refuses a dismissed candidate, an unknown one and an empty list', async () => {
    const destinationId = await seed([imported('osm', 'way/1', 'Šaldun', SALDUN)]);
    const a = await candidateOf(destinationId, 'way/1');
    await dismissCandidate(testDb.db, a, NOW);
    await expect(
      draftCandidates(testDb.db, noopQueue, destinationId, [a], adminId, NOW),
    ).rejects.toMatchObject({
      code: 'invalid-state',
    });
    const other = await seedDestination(testDb.db);
    await expect(
      draftCandidates(testDb.db, noopQueue, other, [a], adminId, NOW),
    ).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(
      draftCandidates(testDb.db, noopQueue, destinationId, [], adminId, NOW),
    ).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });
});

describe('dismiss and restore', () => {
  it('moves a candidate between New and Dismissed, and only from there', async () => {
    const destinationId = await seed([imported('osm', 'way/1', 'Šaldun', SALDUN)]);
    const a = await candidateOf(destinationId, 'way/1');
    await expect(restoreCandidate(testDb.db, a, NOW)).rejects.toMatchObject({
      code: 'invalid-state',
    });
    await dismissCandidate(testDb.db, a, NOW);
    expect((await listCandidates(testDb.db, destinationId, 'dismissed')).candidates).toHaveLength(
      1,
    );
    await restoreCandidate(testDb.db, a, NOW);
    expect((await listCandidates(testDb.db, destinationId, 'new')).counts.new).toBe(1);
    await expect(
      dismissCandidate(testDb.db, '00000000-0000-4000-8000-000000000000', NOW),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('merge, split and keep apart', () => {
  async function twoNearby() {
    // Same source, 20 m apart: never auto-merged, offered as possible duplicates.
    const destinationId = await seed([
      imported('osm', 'node/1', 'Šaldun', SALDUN),
      imported('osm', 'way/1', 'Šaldun', north(SALDUN, 20)),
    ]);
    return {
      destinationId,
      a: await candidateOf(destinationId, 'node/1'),
      b: await candidateOf(destinationId, 'way/1'),
    };
  }

  it('offers possible duplicates and merges a new candidate into a ticked one', async () => {
    const { destinationId, a, b } = await twoNearby();
    const overview = await listCandidates(testDb.db, destinationId, 'new');
    expect(overview.candidates.find((c) => c.id === a)?.possibleDuplicates).toEqual([
      { id: b, name: 'Šaldun', distanceM: 20, score: 1 },
    ]);
    await draftCandidates(testDb.db, noopQueue, destinationId, [b], adminId, NOW);
    expect(await mergeCandidates(testDb.db, b, a, LATER)).toEqual({ candidateId: b });
    const rows = await rowsOf(destinationId);
    expect(rows.every((r) => r.candidateId === b)).toBe(true);
    expect(
      await testDb.db.select().from(seedingCandidates).where(eq(seedingCandidates.id, a)),
    ).toHaveLength(0);
  });

  it('refuses to merge two ticked candidates', async () => {
    const { destinationId, a, b } = await twoNearby();
    await draftCandidates(testDb.db, noopQueue, destinationId, [a, b], adminId, NOW);
    await expect(mergeCandidates(testDb.db, a, b, LATER)).rejects.toMatchObject({
      code: 'invalid-state',
    });
  });

  it('keeps a pair apart so it is no longer offered', async () => {
    const { destinationId, a, b } = await twoNearby();
    await keepApart(testDb.db, b, a, adminId, NOW);
    await keepApart(testDb.db, a, b, adminId, NOW);
    const overview = await listCandidates(testDb.db, destinationId, 'new');
    expect(overview.candidates.every((c) => c.possibleDuplicates.length === 0)).toBe(true);
  });

  it('splits a source row off an auto-merged candidate', async () => {
    const destinationId = await seed([
      imported('bathing_water', 'HR-1', 'Saldun', SALDUN),
      imported('osm', 'way/1', 'Plaža Saldun', north(SALDUN, 40)),
    ]);
    const merged = await candidateOf(destinationId, 'HR-1');
    const [osm] = (await rowsOf(destinationId)).filter((r) => r.externalId === 'way/1');
    if (!osm) throw new Error('no osm row');
    const { candidateId } = await splitSourceRow(testDb.db, osm.id, adminId, NOW);
    expect(candidateId).not.toBe(merged);
    expect(await candidateOf(destinationId, 'way/1')).toBe(candidateId);
    const pairs = await testDb.db.select().from(seedingKeptApart);
    expect(
      pairs.some(
        (p) => [p.candidateA, p.candidateB].sort().join() === [merged, candidateId].sort().join(),
      ),
    ).toBe(true);
    const overview = await listCandidates(testDb.db, destinationId, 'new');
    expect(overview.candidates).toHaveLength(2);
    expect(overview.candidates.every((c) => c.possibleDuplicates.length === 0)).toBe(true);
    // A candidate with one row left cannot be split again.
    await expect(splitSourceRow(testDb.db, osm.id, adminId, NOW)).rejects.toMatchObject({
      code: 'invalid-state',
    });
  });
});

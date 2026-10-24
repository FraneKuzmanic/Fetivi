import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../../db/schema/accounts';
import { destinations } from '../../db/schema/catalog';
import { seedingImports } from '../../db/schema/seeding';
import { QUEUES } from '../../jobs/queue';
import { createTestDatabase, recordingQueue, type TestDatabase, TROGIR } from '../../testing';
import { SourceError } from './errors';
import { runImport, type SourceImporter, startImport } from './import';
import { listCandidates } from './store';
import { parseRecorded } from './testing';
import type { SeedingSource } from './vocabulary';

const NOW = new Date('2027-05-01T10:00:00Z');
const deps = {
  fetch: async () => {
    throw new Error('no network in tests');
  },
  userAgent: 'Fetivi test',
};

let testDb: TestDatabase;
let adminId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email: 'importer@example.test', passwordHash: 'x', role: 'admin' })
    .returning();
  if (!admin) throw new Error('no admin');
  adminId = admin.id;
});

afterAll(async () => {
  await testDb?.drop();
});

/** The recorded area: the TROGIR centre, 3 km. */
async function trogir() {
  const [d] = await testDb.db
    .insert(destinations)
    .values({ name: `Trogir ${randomBytes(4).toString('hex')}`, centre: TROGIR, radiusM: 3000 })
    .returning();
  if (!d) throw new Error('no destination');
  return d.id;
}

/** Importers that parse the recorded extracts, or throw the given error per source. */
const importers = (
  failing: Partial<Record<SeedingSource, Error>> = {},
): Record<SeedingSource, SourceImporter> => {
  const one =
    (source: SeedingSource): SourceImporter =>
    async (area) => {
      const error = failing[source];
      if (error) throw error;
      return parseRecorded(source, area);
    };
  return { osm: one('osm'), bathing_water: one('bathing_water'), overture: one('overture') };
};

async function started(destinationId: string, at = NOW) {
  const queue = recordingQueue();
  const run = await startImport(testDb.db, queue, destinationId, adminId, at);
  return { run, queue };
}

describe('startImport', () => {
  it('records a running import and queues its job once', async () => {
    const destinationId = await trogir();
    const { run, queue } = await started(destinationId);
    expect(run).toMatchObject({ status: 'running', requestedBy: adminId, startedAt: NOW });
    expect(queue.jobs).toEqual([
      { name: QUEUES.importOpenData, data: { importId: run.id }, id: expect.any(String) },
    ]);
  });

  it('refuses a second import while one runs, and replaces a stale one', async () => {
    const destinationId = await trogir();
    const { run } = await started(destinationId);
    await expect(started(destinationId, new Date(NOW.getTime() + 60_000))).rejects.toMatchObject({
      code: 'import-running',
    });
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const { run: next } = await started(destinationId, later);
    expect(next.id).not.toBe(run.id);
    const [old] = await testDb.db
      .select()
      .from(seedingImports)
      .where(eq(seedingImports.id, run.id));
    expect(old).toMatchObject({ status: 'failed', finishedAt: later });
  });

  it('refuses an unknown destination', async () => {
    await expect(started('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

describe('runImport', () => {
  it('imports all three recorded sources into candidates', async () => {
    const destinationId = await trogir();
    const { run } = await started(destinationId);
    const summary = await runImport(testDb.db, run.id, deps, () => NOW, importers());
    expect(summary).toMatchObject({
      status: 'done',
      rows: 187 + 11 + 123,
      candidates: 275,
      sources: {
        osm: { outcome: 'ok', fetched: 242, kept: 187, skipped: 55 },
        bathing_water: { outcome: 'ok', fetched: 11, kept: 11, skipped: 0 },
        overture: { outcome: 'ok', fetched: 334, kept: 123, skipped: 211 },
      },
    });
    const [row] = await testDb.db
      .select()
      .from(seedingImports)
      .where(eq(seedingImports.id, run.id));
    expect(row).toMatchObject({ status: 'done', finishedAt: NOW, sources: summary?.sources });
    const overview = await listCandidates(testDb.db, destinationId, 'new');
    expect(overview.counts.new).toBe(275);
    expect(overview.candidates.some((c) => c.sources.length > 1)).toBe(true);
    expect(overview.lastImport?.id).toBe(run.id);

    // Re-running a finished import does nothing.
    expect(await runImport(testDb.db, run.id, deps, () => NOW, importers())).toBeNull();
  });

  it('isolates a failing source', async () => {
    const destinationId = await trogir();
    const { run } = await started(destinationId);
    const summary = await runImport(
      testDb.db,
      run.id,
      deps,
      () => NOW,
      importers({ osm: new SourceError('unavailable'), overture: new TypeError('boom') }),
    );
    expect(summary?.status).toBe('done');
    expect(summary?.sources).toEqual({
      osm: { outcome: 'failed', failure: 'unavailable' },
      bathing_water: { outcome: 'ok', fetched: 11, kept: 11, skipped: 0 },
      overture: { outcome: 'failed', failure: 'unavailable' },
    });
  });

  it('fails the run when every source fails', async () => {
    const destinationId = await trogir();
    const { run } = await started(destinationId);
    const tooLarge = new SourceError('too-large');
    const summary = await runImport(
      testDb.db,
      run.id,
      deps,
      () => NOW,
      importers({ osm: tooLarge, bathing_water: tooLarge, overture: tooLarge }),
    );
    expect(summary?.status).toBe('failed');
    const [row] = await testDb.db
      .select()
      .from(seedingImports)
      .where(eq(seedingImports.id, run.id));
    expect(row?.status).toBe('failed');
  });
});

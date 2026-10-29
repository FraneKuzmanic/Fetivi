import { catalogRecords, QUEUES } from '@fetivi/domain';
import {
  createTestDatabase,
  fakeEmbedder,
  publishCatalog,
  seedDestination,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EGRESS_ALLOWLIST } from '../egress';
import { embedCatalogRecordJob } from './embed-search-text';
import { createJobs } from './index';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('embed-search-text jobs', () => {
  it('may call Voyage AI', () => {
    expect(EGRESS_ALLOWLIST).toContain('api.voyageai.com');
  });

  it('are registered', () => {
    const names = createJobs({} as Parameters<typeof createJobs>[0]).map((j) => j.name);
    expect(names).toContain(QUEUES.embedCatalogRecord);
    expect(names).toContain(QUEUES.embedHostPlace);
  });

  it('embeds a published record and logs the result without text', async () => {
    const destinationId = await seedDestination(testDb.db);
    const [record] = await testDb.db
      .insert(catalogRecords)
      .values({
        destinationId,
        kind: 'place',
        title: 'Konoba Mala',
        description: 'Grilled fish.',
        placeCategory: 'restaurant',
        location: { x: 16.25, y: 43.51 },
      })
      .returning();
    if (!record) throw new Error('no record');
    await publishCatalog(testDb.db, destinationId);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await embedCatalogRecordJob({ db: testDb.db, embedder: fakeEmbedder() }).handler({
        recordId: record.id,
        revision: 1,
      });
      const line = String(log.mock.calls[0]?.[0]);
      expect(JSON.parse(line)).toMatchObject({
        job: QUEUES.embedCatalogRecord,
        recordId: record.id,
        revision: 1,
        result: 'embedded',
      });
      expect(line).not.toMatch(/Konoba|fish/);
    } finally {
      log.mockRestore();
    }
  });
});

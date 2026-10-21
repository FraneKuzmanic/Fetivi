import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockMedia } from '../db/schema/block-media';
import { infoBlocks } from '../db/schema/info-blocks';
import { loadGuestProjection } from '../projection/load';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../testing';
import { createLocalMediaStore, mediaFilesOf } from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

const HOW_TO = {
  category: 'how_tos' as const,
  title: 'Washer',
  body: 'Program 3.',
  media: [
    { caption: 'The dial', contentType: 'image/jpeg' as const },
    { caption: 'Loading it', contentType: 'video/mp4' as const },
  ],
};

describe('block media in the projection', () => {
  it('lists a published block media with captions in the guest language', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW, blocks: [HOW_TO] });
    const [how] = seed.extraBlocks;
    const p = await loadGuestProjection(testDb.db, {
      unitId: seed.unitId,
      stayId: seed.stayId,
      language: 'de',
      now: NOW,
    });
    const block = p.blocks.find((b) => b.category === 'how_tos');
    expect(block?.media).toEqual([
      { id: how?.media[0], kind: 'image', caption: 'de:The dial' },
      { id: how?.media[1], kind: 'video', caption: 'de:Loading it' },
    ]);
  });

  it('hides an item added at a revision not yet published', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW, blocks: [HOW_TO] });
    const blockId = seed.extraBlocks[0]?.id ?? '';
    await testDb.db.update(infoBlocks).set({ revision: 2 }).where(eq(infoBlocks.id, blockId));
    const [late] = await testDb.db
      .insert(blockMedia)
      .values({
        blockId,
        kind: 'image',
        contentType: 'image/png',
        bytes: 4,
        caption: 'late',
        addedRevision: 2,
        position: 2,
      })
      .returning();
    const p = await loadGuestProjection(testDb.db, {
      unitId: seed.unitId,
      stayId: seed.stayId,
      language: 'en',
      now: NOW,
    });
    expect(JSON.stringify(p)).not.toContain(late?.id);
    expect(p.blocks.find((b) => b.category === 'how_tos')?.media).toHaveLength(2);
  });
});

describe('mediaFilesOf', () => {
  it('finds the files of a block, a unit and a property', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW, blocks: [HOW_TO] });
    const how = seed.extraBlocks[0];
    const expected = [`${how?.media[0]}.jpg`, `${how?.media[1]}.mp4`];
    const sorted = async (p: Promise<string[]>) => (await p).sort();
    expect(await sorted(mediaFilesOf(testDb.db, { blockIds: [how?.id ?? ''] }))).toEqual(
      expected.sort(),
    );
    expect(await sorted(mediaFilesOf(testDb.db, { unitId: seed.unitId }))).toEqual(expected);
    expect(await sorted(mediaFilesOf(testDb.db, { propertyId: seed.propertyId }))).toEqual(
      expected,
    );
    expect(await mediaFilesOf(testDb.db, { blockIds: [] })).toEqual([]);
  });

  it('feeds a store remove that clears the files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fetivi-media-'));
    try {
      const seed = await seedGuestUnit(testDb.db, { now: NOW, blocks: [HOW_TO] });
      const store = createLocalMediaStore(dir);
      const files = await mediaFilesOf(testDb.db, { unitId: seed.unitId });
      for (const f of files) await store.put(f, new Uint8Array([1]));
      await store.remove(files);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

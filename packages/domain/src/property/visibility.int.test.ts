import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { infoBlocks } from '../db/schema/info-blocks';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../testing';
import { blockVisibilityOf } from './vocabulary';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('migration 0054', () => {
  it('rewrites every block to the visibility of its Guide section', async () => {
    const seed = await seedGuestUnit(testDb.db, {
      now: new Date('2026-10-28T10:00:00Z'),
      blocks: [
        { category: 'arrival_access', title: 'Parking', body: 'Behind the house.' },
        { category: 'how_tos', title: 'Washer', body: 'Program 3.' },
        { category: 'contacts_emergency', title: 'Doctor', body: 'Dr. Ivić, 021 555 111.' },
      ],
    });
    const [arrival, howTo, contacts] = seed.extraBlocks.map((b) => b.id) as [
      string,
      string,
      string,
    ];
    // What hosts could choose before ticket 52.
    const set = (id: string, visibility: 'always' | 'after_release') =>
      testDb.db.update(infoBlocks).set({ visibility }).where(eq(infoBlocks.id, id));
    await set(arrival, 'always');
    await set(howTo, 'after_release');
    await set(contacts, 'after_release');

    const file = fileURLToPath(
      new URL('../../drizzle/0054_block_visibility_from_section.sql', import.meta.url),
    );
    await testDb.db.execute(sql.raw(await readFile(file, 'utf8')));

    const ids = [...Object.values(seed.blocks), arrival, howTo, contacts];
    const rows = await testDb.db
      .select({ category: infoBlocks.category, visibility: infoBlocks.visibility })
      .from(infoBlocks)
      .where(inArray(infoBlocks.id, ids));
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) expect(row.visibility).toBe(blockVisibilityOf(row.category));
    expect(rows.filter((r) => r.visibility === 'after_release')).toHaveLength(2);
  });
});

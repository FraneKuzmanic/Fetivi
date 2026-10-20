import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { infoBlocks } from '../db/schema/info-blocks';
import { units } from '../db/schema/properties';
import { blockTranslations } from '../db/schema/translations';
import { GUEST_LANGUAGES } from '../property/vocabulary';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../testing';
import { loadGuestProjection, ProjectionRuleError } from './load';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
// Default seed: check-in 2026-10-21, release one day before at 00:00 Zagreb.
const RELEASED = new Date('2026-10-20T22:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('loadGuestProjection', () => {
  it('returns the guest language texts and holds secrets back until release', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW });
    const ids = { unitId: seed.unitId, stayId: seed.stayId, language: 'de' as const };

    const before = await loadGuestProjection(testDb.db, { ...ids, now: NOW });
    expect(before.unit.name).toBe(seed.unitName);
    expect(before.blocks.map((b) => b.title)).toEqual([seed.alwaysTitle('de')]);
    const json = JSON.stringify(before);
    for (const value of Object.values(seed.secrets)) expect(json).not.toContain(value);
    for (const value of Object.values(seed.private)) expect(json).not.toContain(value);
    expect(json).not.toContain(seed.pin);

    const after = await loadGuestProjection(testDb.db, { ...ids, now: RELEASED });
    expect(after.blocks.map((b) => b.title)).toEqual([
      seed.afterReleaseTitle('de'),
      seed.alwaysTitle('de'),
    ]);
    expect(after.wifi?.password).toBe(seed.secrets.wifiPassword);
    expect(after.arrival?.doorCode).toBe(seed.secrets.doorCode);
  });

  it('refuses a Stay that is not on the unit', async () => {
    const a = await seedGuestUnit(testDb.db, { now: NOW });
    const b = await seedGuestUnit(testDb.db, { now: NOW });
    await expect(
      loadGuestProjection(testDb.db, {
        unitId: b.unitId,
        stayId: a.stayId,
        language: 'en',
        now: NOW,
      }),
    ).rejects.toEqual(new ProjectionRuleError('not-found'));
  });

  it('shows a host edit on the next read', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW });
    const ids = { unitId: seed.unitId, stayId: seed.stayId, language: 'en' as const, now: NOW };
    await testDb.db.update(units).set({ wifiNetwork: 'Renamed' }).where(eq(units.id, seed.unitId));
    expect((await loadGuestProjection(testDb.db, ids)).wifi?.network).toBe('Renamed');
  });

  it('keeps the published text while a new revision is pending, then shows it once published', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW });
    const ids = { unitId: seed.unitId, stayId: seed.stayId, language: 'hr' as const, now: NOW };
    const blockId = seed.blocks.always;

    await testDb.db
      .update(infoBlocks)
      .set({ revision: 2, title: 'Edited source', translationStatus: 'pending' })
      .where(eq(infoBlocks.id, blockId));
    await testDb.db.insert(blockTranslations).values(
      GUEST_LANGUAGES.map((language) => ({
        blockId,
        revision: 2,
        language,
        title: `[${language}] revised`,
        body: 'New body',
        origin: 'machine' as const,
      })),
    );
    expect((await loadGuestProjection(testDb.db, ids)).blocks[0]?.title).toBe(
      seed.alwaysTitle('hr'),
    );

    await testDb.db
      .update(infoBlocks)
      .set({ publishedRevision: 2, translationStatus: 'published' })
      .where(eq(infoBlocks.id, blockId));
    expect((await loadGuestProjection(testDb.db, ids)).blocks[0]?.title).toBe('[hr] revised');
  });
});

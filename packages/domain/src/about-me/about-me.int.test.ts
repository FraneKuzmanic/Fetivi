import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aboutMe as aboutMeTable } from '../db/schema/about-me';
import { spaces } from '../db/schema/spaces';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../testing';
import { AboutMeRuleError, getAboutMe, replaceAboutMe, updateAboutMe } from './store';
import { type AboutMe, type AboutMePatch, EMPTY_ABOUT_ME } from './vocabulary';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

const seedSpace = async () => (await seedGuestUnit(testDb.db, { now: NOW })).spaceId;

describe('about me store', () => {
  it('is empty before anything is saved', async () => {
    const spaceId = await seedSpace();
    expect(await getAboutMe(testDb.db, spaceId)).toEqual(EMPTY_ABOUT_ME);
  });

  it('merges model updates and never touches needs', async () => {
    const spaceId = await seedSpace();
    await replaceAboutMe(testDb.db, spaceId, { ...EMPTY_ABOUT_ME, needs: ['halal'] }, NOW);
    await updateAboutMe(
      testDb.db,
      spaceId,
      { party: 'couple', addInterests: ['nightlife', 'beaches', 'beaches'], pace: 'easy' },
      NOW,
    );
    const after = await updateAboutMe(
      testDb.db,
      spaceId,
      { party: null, addInterests: ['food', 'sights'], removeInterests: ['sights', 'nightlife'] },
      NOW,
    );
    expect(after).toEqual({
      party: null,
      interests: ['beaches', 'food'],
      pace: 'easy',
      budget: null,
      needs: ['halal'],
    });
    expect(await getAboutMe(testDb.db, spaceId)).toEqual(after);
  });

  it('ignores a needs key forced through a cast', async () => {
    const spaceId = await seedSpace();
    const forced = { addInterests: ['food'], needs: ['halal'] } as AboutMePatch;
    const after = await updateAboutMe(testDb.db, spaceId, forced, NOW);
    expect(after.needs).toEqual([]);
    expect(after.interests).toEqual(['food']);
    const [row] = await testDb.db
      .select()
      .from(aboutMeTable)
      .where(eq(aboutMeTable.spaceId, spaceId));
    expect(row?.needs).toEqual([]);
  });

  it('replaces the whole value, needs included, in canonical order', async () => {
    const spaceId = await seedSpace();
    const after = await replaceAboutMe(
      testDb.db,
      spaceId,
      {
        party: 'family',
        interests: ['slow', 'beaches', 'slow'],
        pace: 'mixed',
        budget: 'treat',
        needs: ['step_free', 'gluten_free'],
      },
      NOW,
    );
    expect(after).toEqual({
      party: 'family',
      interests: ['beaches', 'slow'],
      pace: 'mixed',
      budget: 'treat',
      needs: ['gluten_free', 'step_free'],
    });
  });

  it('allows only removals when asked', async () => {
    const spaceId = await seedSpace();
    const full: AboutMe = {
      party: 'friends',
      interests: ['food', 'nature'],
      pace: 'full',
      budget: null,
      needs: ['kosher', 'step_free'],
    };
    await replaceAboutMe(testDb.db, spaceId, full, NOW);
    const removals = { removalsOnly: true };
    for (const blocked of [
      { ...full, interests: ['food', 'nature', 'nightlife'] },
      { ...full, budget: 'mid' },
      { ...full, party: 'couple' },
      { ...full, needs: ['kosher', 'step_free', 'halal'] },
    ] satisfies AboutMe[]) {
      await expect(replaceAboutMe(testDb.db, spaceId, blocked, NOW, removals)).rejects.toThrow(
        AboutMeRuleError,
      );
      expect(await getAboutMe(testDb.db, spaceId)).toEqual(full);
    }
    const reduced: AboutMe = { ...full, interests: ['nature'], pace: null, needs: ['kosher'] };
    expect(await replaceAboutMe(testDb.db, spaceId, reduced, NOW, removals)).toEqual(reduced);
  });

  it('keeps both of two concurrent updates', async () => {
    const spaceId = await seedSpace();
    await Promise.all([
      updateAboutMe(testDb.db, spaceId, { addInterests: ['food'] }, NOW),
      updateAboutMe(testDb.db, spaceId, { addInterests: ['nature'] }, NOW),
    ]);
    expect((await getAboutMe(testDb.db, spaceId)).interests).toEqual(['food', 'nature']);
  });

  it('is deleted with its Space', async () => {
    const spaceId = await seedSpace();
    await updateAboutMe(testDb.db, spaceId, { pace: 'easy' }, NOW);
    await testDb.db.delete(spaces).where(eq(spaces.id, spaceId));
    const rows = await testDb.db
      .select()
      .from(aboutMeTable)
      .where(eq(aboutMeTable.spaceId, spaceId));
    expect(rows).toEqual([]);
  });
});

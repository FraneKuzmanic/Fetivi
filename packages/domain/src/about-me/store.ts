import { eq } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { type AboutMeRow, aboutMe as aboutMeTable } from '../db/schema/about-me';
import {
  type AboutMe,
  type AboutMePatch,
  EMPTY_ABOUT_ME,
  INTERESTS,
  type Interest,
  NEEDS,
  type Need,
} from './vocabulary';

export class AboutMeRuleError extends Error {
  override name = 'AboutMeRuleError';
  constructor(readonly code: 'read-only') {
    super(code);
  }
}

const toAboutMe = (row: AboutMeRow): AboutMe => ({
  party: row.party,
  interests: row.interests,
  pace: row.pace,
  budget: row.budget,
  needs: row.needs,
});

/** Deduplicated, in vocabulary order. */
const canonical = <C extends string>(vocabulary: readonly C[], codes: readonly C[]): C[] => {
  const set = new Set(codes);
  return vocabulary.filter((c) => set.has(c));
};
const canonicalInterests = (codes: readonly Interest[]) => canonical(INTERESTS, codes);
const canonicalNeeds = (codes: readonly Need[]) => canonical(NEEDS, codes);

/** The Space's About me; EMPTY_ABOUT_ME when nothing is saved. */
export async function getAboutMe(db: Executor, spaceId: string): Promise<AboutMe> {
  const [row] = await db.select().from(aboutMeTable).where(eq(aboutMeTable.spaceId, spaceId));
  return row ? toAboutMe(row) : EMPTY_ABOUT_ME;
}

/** Locks the Space's row (creating an empty one first), writes `compute`'s result, returns it. */
async function writeAboutMe(
  db: Db,
  spaceId: string,
  now: Date,
  compute: (current: AboutMe) => AboutMe,
): Promise<AboutMe> {
  return db.transaction(async (tx) => {
    await tx
      .insert(aboutMeTable)
      .values({ spaceId, updatedAt: now })
      .onConflictDoNothing({ target: aboutMeTable.spaceId });
    const [locked] = await tx
      .select()
      .from(aboutMeTable)
      .where(eq(aboutMeTable.spaceId, spaceId))
      .for('update');
    if (!locked) throw new Error(`about_me row missing for ${spaceId}`);
    const next = compute(toAboutMe(locked));
    const [row] = await tx
      .update(aboutMeTable)
      .set({
        party: next.party,
        interests: canonicalInterests(next.interests),
        pace: next.pace,
        budget: next.budget,
        needs: canonicalNeeds(next.needs),
        updatedAt: now,
      })
      .where(eq(aboutMeTable.spaceId, spaceId))
      .returning();
    if (!row) throw new Error(`about_me row missing for ${spaceId}`);
    return toAboutMe(row);
  });
}

/**
 * The model's path (update_about_me): ordinary fields only. `undefined` leaves a field, `null`
 * clears it; removals win over additions. `needs` is always the stored value: the result is built
 * from the patch's known keys, never by spreading it.
 */
export async function updateAboutMe(
  db: Db,
  spaceId: string,
  patch: AboutMePatch,
  now: Date,
): Promise<AboutMe> {
  return writeAboutMe(db, spaceId, now, (current) => {
    const removed = new Set(patch.removeInterests ?? []);
    const interests = [...current.interests, ...(patch.addInterests ?? [])].filter(
      (i) => !removed.has(i),
    );
    return {
      party: patch.party === undefined ? current.party : patch.party,
      interests,
      pace: patch.pace === undefined ? current.pace : patch.pace,
      budget: patch.budget === undefined ? current.budget : patch.budget,
      needs: current.needs,
    };
  });
}

/**
 * The guest app's path: the whole value, special-category `needs` included; the guest's own tap
 * is the credential. With `removalsOnly` (a closed Space) every field must equal the stored one or be
 * cleared, and every list must be a subset of the stored one; otherwise AboutMeRuleError('read-only').
 */
export async function replaceAboutMe(
  db: Db,
  spaceId: string,
  next: AboutMe,
  now: Date,
  opts: { removalsOnly?: boolean } = {},
): Promise<AboutMe> {
  return writeAboutMe(db, spaceId, now, (current) => {
    if (opts.removalsOnly) {
      const keptOrCleared = <T>(was: T | null, now: T | null) => now === null || now === was;
      const subset = <T>(was: readonly T[], now: readonly T[]) => now.every((c) => was.includes(c));
      const ok =
        keptOrCleared(current.party, next.party) &&
        keptOrCleared(current.pace, next.pace) &&
        keptOrCleared(current.budget, next.budget) &&
        subset(current.interests, next.interests) &&
        subset(current.needs, next.needs);
      if (!ok) throw new AboutMeRuleError('read-only');
    }
    return {
      party: next.party,
      interests: next.interests,
      pace: next.pace,
      budget: next.budget,
      needs: next.needs,
    };
  });
}

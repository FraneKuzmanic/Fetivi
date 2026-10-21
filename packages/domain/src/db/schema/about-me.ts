import { pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { BUDGETS, INTERESTS, NEEDS, PACES, PARTY_SHAPES } from '../../about-me/vocabulary';
import { spaces } from './spaces';

export const aboutMeParty = pgEnum('about_me_party', PARTY_SHAPES);
export const aboutMeInterest = pgEnum('about_me_interest', INTERESTS);
export const aboutMePace = pgEnum('about_me_pace', PACES);
export const aboutMeBudget = pgEnum('about_me_budget', BUDGETS);
export const aboutMeNeed = pgEnum('about_me_need', NEEDS);

/** One Space's About me; no row = nothing saved. Deleted with the Space. */
export const aboutMe = pgTable('about_me', {
  spaceId: uuid('space_id')
    .primaryKey()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  party: aboutMeParty('party'),
  /** Unique, in INTERESTS order. */
  interests: aboutMeInterest('interests').array().notNull().default([]),
  pace: aboutMePace('pace'),
  budget: aboutMeBudget('budget'),
  /** Special-category: written only by replaceAboutMe (the guest app's own tap), never by a tool. */
  needs: aboutMeNeed('needs').array().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export type AboutMeRow = typeof aboutMe.$inferSelect;

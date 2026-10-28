import { pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { BUDGETS, INTERESTS, PACES, PARTY_SHAPES, TRANSPORTS } from '../../about-me/vocabulary';
import { spaces } from './spaces';

export const aboutMeParty = pgEnum('about_me_party', PARTY_SHAPES);
export const aboutMeInterest = pgEnum('about_me_interest', INTERESTS);
export const aboutMePace = pgEnum('about_me_pace', PACES);
export const aboutMeBudget = pgEnum('about_me_budget', BUDGETS);
export const aboutMeTransport = pgEnum('about_me_transport', TRANSPORTS);
/** The stored enum keeps 'halal' and 'kosher' (ticket 55 removed them from NEEDS; 0057 cleared them from rows). */
const STORED_NEEDS = [
  'gluten_free',
  'food_allergy',
  'halal',
  'kosher',
  'step_free',
  'limited_mobility',
] as const;
export const aboutMeNeed = pgEnum('about_me_need', STORED_NEEDS);

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
  transport: aboutMeTransport('transport'),
  /** Special-category: written only by replaceAboutMe (the guest app's own tap), never by a tool. */
  needs: aboutMeNeed('needs').array().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export type AboutMeRow = typeof aboutMe.$inferSelect;

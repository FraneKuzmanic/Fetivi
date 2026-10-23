import { describe, expect, it } from 'vitest';
import {
  budgetUsed,
  isPastBudget,
  type StalenessInput,
  stalenessKeyOf,
  stalenessOf,
} from './staleness';
import { CATALOG_KINDS, PLACE_CATEGORIES, STALENESS_BUDGET_DAYS } from './vocabulary';

const NOW = new Date('2027-06-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const place = (placeCategory: StalenessInput['placeCategory'], verifiedAt: Date | null) => ({
  kind: 'place' as const,
  placeCategory,
  verifiedAt,
  endsAt: null,
});

describe('stalenessOf', () => {
  it('keeps a restaurant fresh at 89 days and stale at 90', () => {
    expect(stalenessOf(place('restaurant', daysAgo(89)), NOW).status).toBe('fresh');
    const stale = stalenessOf(place('restaurant', daysAgo(90)), NOW);
    expect(stale.status).toBe('stale');
    expect(stale.staleAt).toEqual(NOW);
  });

  it('keeps a beach fresh at 364 days', () => {
    expect(stalenessOf(place('beach', daysAgo(364)), NOW).status).toBe('fresh');
    expect(stalenessOf(place('beach', daysAgo(365)), NOW).status).toBe('stale');
  });

  it('gives a transport note 180 days', () => {
    const note = { kind: 'transport_note' as const, placeCategory: null, endsAt: null };
    expect(stalenessOf({ ...note, verifiedAt: daysAgo(179) }, NOW).status).toBe('fresh');
    expect(stalenessOf({ ...note, verifiedAt: daysAgo(180) }, NOW).status).toBe('stale');
  });

  it('counts a record never verified as never_verified', () => {
    expect(stalenessOf(place('sight', null), NOW)).toEqual({
      status: 'never_verified',
      staleAt: null,
    });
  });

  it('never makes an event stale, but expires it at endsAt', () => {
    const event = { kind: 'event' as const, placeCategory: null, verifiedAt: daysAgo(1000) };
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect(stalenessOf({ ...event, endsAt: tomorrow }, NOW)).toEqual({
      status: 'fresh',
      staleAt: null,
    });
    expect(stalenessOf({ ...event, endsAt: NOW }, NOW).status).toBe('expired');
  });

  it('calls an ended event that was never verified expired', () => {
    const event = { kind: 'event' as const, placeCategory: null, verifiedAt: null };
    expect(stalenessOf({ ...event, endsAt: daysAgo(1) }, NOW).status).toBe('expired');
  });
});

describe('isPastBudget', () => {
  it.each([
    ['fresh', place('nature', daysAgo(1)), false],
    ['stale', place('shop', daysAgo(100)), true],
    ['never_verified', place('shop', null), true],
    [
      'expired',
      { kind: 'event' as const, placeCategory: null, verifiedAt: null, endsAt: daysAgo(1) },
      false,
    ],
  ])('%s', (_status, input, expected) => {
    expect(isPastBudget(input, NOW)).toBe(expected);
  });
});

describe('budgets', () => {
  it('has a budget for every catalog category', () => {
    const categories = [
      ...PLACE_CATEGORIES,
      ...CATALOG_KINDS.filter((k) => k !== 'place'),
    ] as const;
    for (const c of categories) expect(STALENESS_BUDGET_DAYS).toHaveProperty(c);
    expect(Object.keys(STALENESS_BUDGET_DAYS)).toHaveLength(categories.length);
  });

  it('refuses a place without a category', () => {
    expect(() => stalenessKeyOf({ kind: 'place', placeCategory: null })).toThrow();
  });
});

describe('budgetUsed', () => {
  it('is the share of the budget since verified_at', () => {
    const r = { ...place('restaurant', daysAgo(45)), createdAt: daysAgo(400) };
    expect(budgetUsed(r, NOW)).toEqual({ used: 0.5, days: 90 });
  });

  it('counts a never-verified record from created_at, and at least as stale', () => {
    expect(budgetUsed({ ...place('restaurant', null), createdAt: daysAgo(180) }, NOW)?.used).toBe(
      2,
    );
    expect(budgetUsed({ ...place('restaurant', null), createdAt: daysAgo(1) }, NOW)?.used).toBe(1);
  });
});

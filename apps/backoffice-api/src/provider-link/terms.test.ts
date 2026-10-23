import type { ProviderLinkView } from '@fetivi/domain';
import { describe, expect, it } from 'vitest';
import { checkNewTerms } from './terms';

const view = (extra: Partial<ProviderLinkView> = {}) =>
  ({
    date: '2026-10-22',
    startTime: '09:00',
    stayFrom: '2026-10-21',
    stayTo: '2026-10-24',
    needsPrice: false,
    ...extra,
  }) as ProviderLinkView;

describe('checkNewTerms', () => {
  it('takes a date in the stay with an optional time and price', () => {
    expect(checkNewTerms(view(), { date: '2026-10-23', time: '10:30' }, false)).toEqual({
      date: '2026-10-23',
      time: '10:30',
    });
    expect(checkNewTerms(view(), { date: '2026-10-24', time: '' }, false)).toEqual({
      date: '2026-10-24',
    });
    expect(checkNewTerms(view(), { date: '2026-10-21', priceMinor: 500 }, false)).toEqual({
      date: '2026-10-21',
      priceMinor: 500,
    });
  });

  it('refuses a date outside the stay, then a bad time', () => {
    expect(checkNewTerms(view(), { date: '2026-10-25' }, false)).toBe('date');
    expect(checkNewTerms(view(), { date: '2026-10-20' }, false)).toBe('date');
    expect(checkNewTerms(view(), {}, false)).toBe('date');
    expect(checkNewTerms(view(), { date: '2026-10-23', time: '9:00' }, false)).toBe('time');
  });

  it('needs a price when the view says so', () => {
    expect(checkNewTerms(view({ needsPrice: true }), { date: '2026-10-23' }, false)).toBe('price');
  });

  it('keeps the shown date and time for Accept with price', () => {
    expect(checkNewTerms(view(), { date: '2026-10-23', time: '11:00' }, true)).toBe('price');
    expect(checkNewTerms(view(), { date: '2026-10-23', priceMinor: 900 }, true)).toEqual({
      date: '2026-10-22',
      time: '09:00',
      priceMinor: 900,
    });
  });
});

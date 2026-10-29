import { describe, expect, it } from 'vitest';
import { fromLocalDateTime } from '../time';
import type { WeatherWarning } from '../weather/source';
import { orderWarnings } from './warnings';

const zone = 'Europe/Zagreb';
const checkout = '2026-10-31';
const at = (date: string, time: string) => fromLocalDateTime(`${date}T${time}`, zone);
const now = at('2026-10-29', '20:00');

const wind = (from: Date, to: Date, overrides: Partial<WeatherWarning> = {}): WeatherWarning => ({
  level: 'yellow',
  type: 'wind',
  event: 'Yellow wind warning',
  description: 'Strong bura.',
  area: 'Middle Dalmatia region',
  onset: from.toISOString(),
  expires: to.toISOString(),
  ...overrides,
});
const overCheckoutDay = wind(at(checkout, '06:00'), at(checkout, '23:00'));

const base = {
  date: checkout,
  start: at(checkout, '09:00') as Date | null,
  zone,
  now,
  checkout,
  checkoutTime: '10:00' as string | null,
  category: 'boat_trip' as const,
  weather: [] as WeatherWarning[] | null,
};

describe('orderWarnings', () => {
  it('warns of checkout and wind for the Blue Lagoon trip on checkout day', () => {
    expect(orderWarnings({ ...base, weather: [overCheckoutDay] })).toEqual([
      { kind: 'checkout_day', checkoutTime: '10:00' },
      {
        kind: 'weather',
        level: 'yellow',
        type: 'wind',
        event: 'Yellow wind warning',
        onset: overCheckoutDay.onset,
        expires: overCheckoutDay.expires,
      },
    ]);
  });

  it('does not warn when the start is at least an hour after checkout', () => {
    expect(orderWarnings({ ...base, start: at(checkout, '11:30') })).toEqual([]);
  });

  it('warns when the start is less than an hour after checkout', () => {
    expect(orderWarnings({ ...base, start: at(checkout, '10:45') })).toEqual([
      { kind: 'checkout_day', checkoutTime: '10:00' },
    ]);
  });

  it('warns on checkout day when the start is unknown', () => {
    expect(orderWarnings({ ...base, start: null })).toEqual([
      { kind: 'checkout_day', checkoutTime: '10:00' },
    ]);
  });

  it('warns on checkout day without a time when no checkout time is set', () => {
    expect(orderWarnings({ ...base, start: at(checkout, '15:00'), checkoutTime: null })).toEqual([
      { kind: 'checkout_day', checkoutTime: null },
    ]);
  });

  it('does not warn of checkout on another day', () => {
    expect(
      orderWarnings({ ...base, date: '2026-10-30', start: at('2026-10-30', '09:00') }),
    ).toEqual([]);
  });

  it('warns of checkout for every category', () => {
    expect(orderWarnings({ ...base, category: 'transfer' })).toEqual([
      { kind: 'checkout_day', checkoutTime: '10:00' },
    ]);
  });

  it('ignores weather for indoor categories', () => {
    expect(
      orderWarnings({
        ...base,
        date: '2026-10-30',
        category: 'tasting',
        weather: [wind(at('2026-10-30', '00:00'), at('2026-10-30', '23:00'))],
      }),
    ).toEqual([]);
  });

  it('ignores warning types other than wind and thunderstorm', () => {
    const fog = wind(at('2026-10-30', '00:00'), at('2026-10-30', '23:00'), { type: 'fog' });
    expect(orderWarnings({ ...base, date: '2026-10-30', weather: [fog] })).toEqual([]);
  });

  it('ignores warnings not in force on the day', () => {
    const before = wind(at('2026-10-29', '06:00'), at('2026-10-29', '23:00'));
    const after = wind(at('2026-10-31', '00:00'), at('2026-10-31', '12:00'));
    expect(orderWarnings({ ...base, date: '2026-10-30', weather: [before, after] })).toEqual([]);
  });

  it('adds no weather warning when the weather could not be checked', () => {
    expect(orderWarnings({ ...base, date: '2026-10-30', weather: null })).toEqual([]);
  });

  it('keeps at most three weather warnings, the most severe', () => {
    const day = (level: WeatherWarning['level'], event: string) =>
      wind(at('2026-10-30', '06:00'), at('2026-10-30', '20:00'), { level, event });
    const warnings = orderWarnings({
      ...base,
      date: '2026-10-30',
      weather: [day('yellow', 'a'), day('yellow', 'b'), day('orange', 'c'), day('red', 'd')],
    });
    expect(warnings.map((w) => (w.kind === 'weather' ? w.event : ''))).toEqual(['d', 'c', 'a']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertStayDates,
  isActive,
  needsPinWarning,
  StayRuleError,
  stayPhase,
  stayTimes,
} from './rules';

const ZG = 'Europe/Zagreb';
const at = (iso: string) => new Date(iso);

describe('stayTimes', () => {
  it.each([
    ['in summer time', '2026-10-20', '2026-10-20T22:00:00.000Z'],
    ['on the day DST ends', '2026-10-25', '2026-10-25T23:00:00.000Z'],
    ['on the day DST starts', '2026-03-29', '2026-03-29T22:00:00.000Z'],
  ])('ends at the end of checkout day %s', (_, checkout, expected) => {
    const { activeUntil } = stayTimes({ checkIn: '2026-03-01', checkout }, ZG, 1);
    expect(activeUntil.toISOString()).toBe(expected);
  });

  it.each([
    [0, '2026-10-22T22:00:00.000Z'],
    [1, '2026-10-21T22:00:00.000Z'],
    [7, '2026-10-15T22:00:00.000Z'],
  ])('releases arrival details %i days before check-in at 00:00', (days, expected) => {
    const { arrivalReleaseAt } = stayTimes(
      { checkIn: '2026-10-23', checkout: '2026-10-26' },
      ZG,
      days,
    );
    expect(arrivalReleaseAt.toISOString()).toBe(expected);
  });
});

describe('isActive', () => {
  const stay = stayTimes({ checkIn: '2026-10-18', checkout: '2026-10-20' }, ZG, 1);

  it('is active until the last millisecond of checkout day', () => {
    expect(isActive(stay, at('2026-10-20T21:59:59.999Z'))).toBe(true);
  });

  it('ends exactly at the end of checkout day and stays ended', () => {
    expect(isActive(stay, at('2026-10-20T22:00:00.000Z'))).toBe(false);
    expect(isActive(stay, at('2026-10-21T08:00:00.000Z'))).toBe(false);
  });
});

describe('needsPinWarning', () => {
  const base = {
    checkIn: '2026-10-23',
    ...stayTimes({ checkIn: '2026-10-23', checkout: '2026-10-25' }, ZG, 1),
    pinSentAt: null,
  };

  it('is off at 23:59 four days before check-in', () => {
    expect(needsPinWarning(base, ZG, at('2026-10-19T21:59:00Z'))).toBe(false);
  });

  it('starts at 00:00 three days before check-in, property time', () => {
    expect(needsPinWarning(base, ZG, at('2026-10-19T22:00:00Z'))).toBe(true);
  });

  it('is off once the PIN is ticked as sent', () => {
    expect(
      needsPinWarning(
        { ...base, pinSentAt: at('2026-10-19T08:00:00Z') },
        ZG,
        at('2026-10-20T10:00:00Z'),
      ),
    ).toBe(false);
  });

  it('is off after the Stay ended', () => {
    expect(needsPinWarning(base, ZG, base.activeUntil)).toBe(false);
  });
});

describe('stayPhase', () => {
  const stay = {
    checkIn: '2026-10-23',
    ...stayTimes({ checkIn: '2026-10-23', checkout: '2026-10-25' }, ZG, 1),
  };

  it('is upcoming until 00:00 on check-in day', () => {
    expect(stayPhase(stay, ZG, at('2026-10-22T21:59:59.999Z'))).toBe('upcoming');
  });

  it('is in stay from 00:00 on check-in day', () => {
    expect(stayPhase(stay, ZG, at('2026-10-22T22:00:00.000Z'))).toBe('in_stay');
    expect(stayPhase(stay, ZG, at('2026-10-25T22:59:59.999Z'))).toBe('in_stay');
  });

  it('has ended at the end of checkout day', () => {
    expect(stayPhase(stay, ZG, at('2026-10-25T23:00:00.000Z'))).toBe('ended');
  });
});

describe('assertStayDates', () => {
  const now = at('2026-10-19T10:00:00Z');
  const check = (checkIn: string, checkout: string) => () =>
    assertStayDates({ checkIn, checkout }, ZG, now);

  it.each([
    ['checkout on the check-in day', '2026-11-01', '2026-11-01'],
    ['checkout before check-in', '2026-11-02', '2026-11-01'],
    ['91 nights', '2026-11-01', '2027-01-31'],
    ['a Stay whose checkout day has ended', '2026-10-15', '2026-10-18'],
    ['check-in 731 days ahead', '2028-10-19', '2028-10-21'],
    ['an impossible date', '2026-02-30', '2026-03-02'],
    ['a malformed date', '2026-1-5', '2026-01-08'],
  ])('rejects %s', (_, checkIn, checkout) => {
    expect(check(checkIn, checkout)).toThrow(StayRuleError);
  });

  it.each([
    ['a guest already in the unit', '2026-10-18', '2026-10-20'],
    ['checkout today', '2026-10-15', '2026-10-19'],
    ['90 nights', '2026-11-01', '2027-01-30'],
    ['check-in 730 days ahead', '2028-10-18', '2028-10-20'],
  ])('accepts %s', (_, checkIn, checkout) => {
    expect(check(checkIn, checkout)).not.toThrow();
  });
});

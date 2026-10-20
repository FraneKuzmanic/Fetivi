import { afterEach, describe, expect, it } from 'vitest';
import {
  arrivalReleaseAt,
  endOfCheckoutDay,
  fromLocalDateTime,
  InvalidTimeInputError,
  startOfCivilDay,
  toLocalDateTime,
} from './index';

const ZG = 'Europe/Zagreb';

describe('civil-day helpers', () => {
  it.each([
    [
      'end of checkout day in summer time',
      () => endOfCheckoutDay('2026-10-24', ZG),
      '2026-10-24T22:00:00.000Z',
    ],
    [
      'end of checkout day on DST end',
      () => endOfCheckoutDay('2026-10-25', ZG),
      '2026-10-25T23:00:00.000Z',
    ],
    [
      'release when the day before is DST start',
      () => arrivalReleaseAt('2027-03-29', ZG),
      '2027-03-27T23:00:00.000Z',
    ],
    [
      'release the day after DST start',
      () => arrivalReleaseAt('2027-03-30', ZG),
      '2027-03-28T22:00:00.000Z',
    ],
    [
      'release on the check-in day',
      () => arrivalReleaseAt('2027-03-30', ZG, 0),
      '2027-03-29T22:00:00.000Z',
    ],
    [
      'release seven days before',
      () => arrivalReleaseAt('2027-03-30', ZG, 7),
      '2027-03-22T23:00:00.000Z',
    ],
    [
      'start of a day whose local midnight does not exist',
      () => startOfCivilDay('2026-09-06', 'America/Santiago'),
      '2026-09-06T04:00:00.000Z',
    ],
  ])('%s', (_name, run, expected) => {
    expect(run().toISOString()).toBe(expected);
  });

  it.each([
    ['unknown zone', () => startOfCivilDay('2026-10-25', 'Mars/Base')],
    ['impossible date', () => startOfCivilDay('2026-02-30', ZG)],
    ['date with a time', () => startOfCivilDay('2026-10-25T10:00', ZG)],
    ['negative daysBefore', () => arrivalReleaseAt('2026-10-25', ZG, -1)],
    ['daysBefore above 7', () => arrivalReleaseAt('2026-10-25', ZG, 8)],
    ['fractional daysBefore', () => arrivalReleaseAt('2026-10-25', ZG, 1.5)],
  ])('rejects %s', (_name, run) => {
    expect(run).toThrow(InvalidTimeInputError);
  });

  describe('server zone', () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    it('does not depend on process.env.TZ', () => {
      process.env.TZ = 'America/New_York';
      expect(endOfCheckoutDay('2026-10-25', ZG).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    });
  });
});

describe('local date-time helpers', () => {
  it.each([
    ['summer', '2027-07-01T20:00', '2027-07-01T18:00:00.000Z'],
    ['winter', '2027-01-15T09:30', '2027-01-15T08:30:00.000Z'],
  ])('round-trips a %s time in Zagreb', (_name, local, iso) => {
    const instant = fromLocalDateTime(local, ZG);
    expect(instant.toISOString()).toBe(iso);
    expect(toLocalDateTime(instant, ZG)).toBe(local);
  });

  it.each([
    ['a time in the spring-forward gap', '2027-03-28T02:30'],
    ['a malformed value', '2027-07-01 20:00'],
    ['an impossible date', '2027-02-30T10:00'],
  ])('rejects %s', (_name, local) => {
    expect(() => fromLocalDateTime(local, ZG)).toThrow(InvalidTimeInputError);
  });
});

import { describe, expect, it } from 'vitest';
import { inSeason, monthDayOf, openStateAt } from './calendar';

const range = (fromMonth: number, fromDay: number, toMonth: number, toDay: number) => ({
  fromMonth,
  fromDay,
  toMonth,
  toDay,
});
const hours = (
  weekday: number,
  opens: string,
  closes: string,
  validFrom: string | null = null,
  validTo: string | null = null,
) => ({ weekday, opens, closes, validFrom, validTo });

describe('monthDayOf', () => {
  it('reads the month and day of a civil date', () => {
    expect(monthDayOf('2027-07-09')).toEqual({ month: 7, day: 9 });
  });
});

describe('inSeason', () => {
  const summer = [range(5, 1, 9, 30)];

  it('is inclusive at both ends of a plain range', () => {
    expect(inSeason(summer, { month: 7, day: 15 })).toBe(true);
    expect(inSeason(summer, { month: 5, day: 1 })).toBe(true);
    expect(inSeason(summer, { month: 9, day: 30 })).toBe(true);
    expect(inSeason(summer, { month: 4, day: 30 })).toBe(false);
    expect(inSeason(summer, { month: 10, day: 1 })).toBe(false);
  });

  it('wraps the new year when from is after to', () => {
    const winter = [range(11, 1, 3, 31)];
    expect(inSeason(winter, { month: 12, day: 15 })).toBe(true);
    expect(inSeason(winter, { month: 2, day: 10 })).toBe(true);
    expect(inSeason(winter, { month: 6, day: 1 })).toBe(false);
  });

  it('treats no rows as all year', () => {
    expect(inSeason([], { month: 1, day: 1 })).toBe(true);
  });

  it('ORs several rows', () => {
    const rows = [range(3, 1, 3, 31), range(9, 1, 9, 30)];
    expect(inSeason(rows, { month: 3, day: 10 })).toBe(true);
    expect(inSeason(rows, { month: 9, day: 10 })).toBe(true);
    expect(inSeason(rows, { month: 6, day: 10 })).toBe(false);
  });
});

describe('openStateAt', () => {
  // 2027-07-12 is a Monday (ISO weekday 1).
  const monday = '2027-07-12';

  it('is open inside the hours and closed at exactly the closing time', () => {
    const rows = [hours(1, '09:00:00', '21:00:00')];
    expect(openStateAt(rows, monday, '09:00')).toBe('open');
    expect(openStateAt(rows, monday, '20:59')).toBe('open');
    expect(openStateAt(rows, monday, '21:00')).toBe('closed');
    expect(openStateAt(rows, monday, '08:59')).toBe('closed');
  });

  it('is closed on a weekday without a row', () => {
    expect(openStateAt([hours(2, '09:00', '21:00')], monday, '10:00')).toBe('closed');
  });

  it('runs an overnight row past midnight into the next day', () => {
    const rows = [hours(1, '22:00', '02:00')];
    expect(openStateAt(rows, monday, '23:00')).toBe('open');
    expect(openStateAt(rows, '2027-07-13', '01:00')).toBe('open');
    expect(openStateAt(rows, '2027-07-13', '03:00')).toBe('closed');
    expect(openStateAt(rows, monday, '01:00')).toBe('closed');
  });

  it('is unknown outside every row validity and decides inside it', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((d) =>
      hours(d, '09:00', '21:00', '2027-04-01', '2027-10-31'),
    );
    expect(openStateAt(rows, '2027-01-15', '10:00')).toBe('unknown');
    expect(openStateAt(rows, monday, '10:00')).toBe('open');
    expect(openStateAt(rows, monday, '22:00')).toBe('closed');
  });

  it('is unknown with no rows at all', () => {
    expect(openStateAt([], monday, '10:00')).toBe('unknown');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  formatDate,
  HALF_HOURS,
  monthGrid,
  parseDate,
  parseTime,
} from './datetime';

describe('parseDate', () => {
  it.each([
    ['27.10.2026', '2026-10-27'],
    ['27/10/2026', '2026-10-27'],
    ['7.1.26', '2026-01-07'],
    ['27.10.', '2026-10-27'],
    ['27.10', '2026-10-27'],
    ['2026-10-27', '2026-10-27'],
    [' 29.02.2028 ', '2028-02-29'],
  ])('reads %s', (text, iso) => {
    expect(parseDate(text, 2026)).toBe(iso);
  });

  it.each(['31.11.2026', '29.02.2027', '10/27/2026', 'tomorrow', '', '1.13.2026'])(
    'refuses %s',
    (text) => {
      expect(parseDate(text, 2026)).toBeNull();
    },
  );
});

describe('formatDate', () => {
  it('shows the day first', () => {
    expect(formatDate('2026-10-27')).toBe('27.10.2026');
    expect(formatDate(null)).toBe('');
  });
});

describe('parseTime', () => {
  it.each([
    ['15:00', '15:00'],
    ['15.30', '15:30'],
    ['1530', '15:30'],
    ['9', '09:00'],
    ['0', '00:00'],
    ['23:59', '23:59'],
  ])('reads %s', (text, time) => {
    expect(parseTime(text)).toBe(time);
  });

  it.each(['24:00', '12:60', '3pm', '', '1:5'])('refuses %s', (text) => {
    expect(parseTime(text)).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('lays out October 2026 from Monday', () => {
    const weeks = monthGrid(2026, 10);
    // 1 October 2026 is a Thursday.
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('moves by days and months', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('lists every half hour', () => {
    expect(HALF_HOURS).toHaveLength(48);
    expect(HALF_HOURS[31]).toBe('15:30');
  });
});

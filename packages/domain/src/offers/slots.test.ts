import { describe, expect, it } from 'vitest';
import { expandWeeklySchedule } from './slots';

const ZONE = 'Europe/Zagreb';
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

describe('expandWeeklySchedule', () => {
  it('gives each chosen weekday each time over a two-week range', () => {
    // 2027-03-01 is a Monday.
    const { startsAt, skipped } = expandWeeklySchedule(
      { from: '2027-03-01', to: '2027-03-14', weekdays: [1, 3, 5], times: ['17:30', '09:00'] },
      ZONE,
    );
    expect(startsAt).toHaveLength(12);
    expect(skipped).toBe(0);
    expect(startsAt[0]?.toISOString()).toBe('2027-03-01T08:00:00.000Z');
    expect(startsAt[1]?.toISOString()).toBe('2027-03-01T16:30:00.000Z');
  });

  it('follows the UTC offset across the autumn change', () => {
    const { startsAt } = expandWeeklySchedule(
      { from: '2027-10-30', to: '2027-10-31', weekdays: ALL_DAYS, times: ['09:00'] },
      ZONE,
    );
    expect(startsAt.map((d) => d.toISOString())).toEqual([
      '2027-10-30T07:00:00.000Z',
      '2027-10-31T08:00:00.000Z',
    ]);
  });

  it('skips a time that does not exist on the spring-forward day', () => {
    const { startsAt, skipped } = expandWeeklySchedule(
      { from: '2027-03-27', to: '2027-03-28', weekdays: ALL_DAYS, times: ['02:30'] },
      ZONE,
    );
    expect(startsAt.map((d) => d.toISOString())).toEqual(['2027-03-27T01:30:00.000Z']);
    expect(skipped).toBe(1);
  });

  it('handles a one-day range and gives nothing when from is after to', () => {
    const one = expandWeeklySchedule(
      { from: '2027-06-01', to: '2027-06-01', weekdays: ALL_DAYS, times: ['10:00'] },
      ZONE,
    );
    expect(one.startsAt).toHaveLength(1);
    const none = expandWeeklySchedule(
      { from: '2027-06-02', to: '2027-06-01', weekdays: ALL_DAYS, times: ['10:00'] },
      ZONE,
    );
    expect(none).toEqual({ startsAt: [], skipped: 0 });
  });

  it('returns the instants sorted', () => {
    const { startsAt } = expandWeeklySchedule(
      {
        from: '2027-06-01',
        to: '2027-06-03',
        weekdays: ALL_DAYS,
        times: ['20:00', '08:00', '12:00'],
      },
      ZONE,
    );
    const times = startsAt.map((d) => d.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times).toHaveLength(9);
  });
});

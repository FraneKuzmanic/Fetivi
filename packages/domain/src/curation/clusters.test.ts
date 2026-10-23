import { describe, expect, it } from 'vitest';
import { clusterKey, previousWeek } from './clusters';

describe('clusterKey', () => {
  it('ignores word order, case, repeats and spacing', () => {
    expect(clusterKey('kayak rental')).toBe('kayak rental');
    expect(clusterKey('Rental  KAYAK')).toBe('kayak rental');
    expect(clusterKey(' kayak kayak rental ')).toBe('kayak rental');
    expect(clusterKey('boat tour')).not.toBe(clusterKey('kayak rental'));
  });
});

describe('previousWeek', () => {
  it('is the week before a Monday 03:00Z run', () => {
    const week = previousWeek(new Date('2027-07-12T03:00:00Z'));
    expect(week).toEqual({
      start: new Date('2027-07-05T00:00:00Z'),
      end: new Date('2027-07-12T00:00:00Z'),
      weekStart: '2027-07-05',
    });
  });

  it('on a Sunday is the week before the current one', () => {
    expect(previousWeek(new Date('2027-07-18T23:59:00Z')).weekStart).toBe('2027-07-05');
  });

  it('crosses a year boundary', () => {
    const week = previousWeek(new Date('2027-01-04T03:00:00Z'));
    expect(week.start).toEqual(new Date('2026-12-28T00:00:00Z'));
    expect(week.end).toEqual(new Date('2027-01-04T00:00:00Z'));
  });
});

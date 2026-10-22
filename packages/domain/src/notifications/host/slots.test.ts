import { describe, expect, it } from 'vitest';
import { digestSlotAt, dueDigestSlot } from './slots';

const ZAGREB = 'Europe/Zagreb';
const TIMES = ['09:00', '14:00', '19:00'];

function due(times: readonly string[], zone: string, now: string): string | undefined {
  return dueDigestSlot(times, zone, new Date(now))?.toISOString();
}

describe('digest slots in the property timezone', () => {
  it('is 09:00 Zagreb summer time (UTC+2) just after the slot', () => {
    expect(due(TIMES, ZAGREB, '2026-07-10T07:05:00Z')).toBe('2026-07-10T07:00:00.000Z');
  });

  it("is yesterday's 19:00 before the first slot of the day", () => {
    expect(due(TIMES, ZAGREB, '2026-07-10T06:00:00Z')).toBe('2026-07-09T17:00:00.000Z');
  });

  it('is 09:00 Zagreb winter time (UTC+1)', () => {
    expect(due(TIMES, ZAGREB, '2026-01-15T08:00:00Z')).toBe('2026-01-15T08:00:00.000Z');
  });

  it('gives a different instant in another zone', () => {
    expect(due(TIMES, 'Europe/London', '2026-07-10T08:05:00Z')).toBe('2026-07-10T08:00:00.000Z');
    expect(due(TIMES, ZAGREB, '2026-07-10T08:05:00Z')).toBe('2026-07-10T07:00:00.000Z');
  });

  it('moves a spring-forward gap time to 03:30 local without throwing', () => {
    expect(digestSlotAt('2026-03-29', '02:30', ZAGREB).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(due(['02:30'], ZAGREB, '2026-03-29T02:00:00Z')).toBe('2026-03-29T01:30:00.000Z');
  });

  it('keeps one slot in the fall-back overlap, and 09:00 is 08:00Z after it', () => {
    expect(digestSlotAt('2026-10-25', '02:30', ZAGREB).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(due(['02:30'], ZAGREB, '2026-10-25T01:45:00Z')).toBe('2026-10-25T00:30:00.000Z');
    expect(due(TIMES, ZAGREB, '2026-10-25T08:01:00Z')).toBe('2026-10-25T08:00:00.000Z');
  });

  it('finds the latest due slot from unsorted times', () => {
    expect(due(['19:00', '09:00', '14:00'], ZAGREB, '2026-07-10T15:00:00Z')).toBe(
      '2026-07-10T12:00:00.000Z',
    );
  });

  it('is due exactly at the slot', () => {
    expect(due(TIMES, ZAGREB, '2026-07-10T12:00:00Z')).toBe('2026-07-10T12:00:00.000Z');
  });

  it('is null only without times', () => {
    expect(dueDigestSlot([], ZAGREB, new Date('2026-07-10T12:00:00Z'))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { maxResponseWindowMinutes } from '../offers/vocabulary';
import { fromLocalDateTime, toLocalDateTime } from '../time';
import { RESPONSE_WINDOW_CAP_HOURS, responseDueAt } from './response-window';

const ZONE = 'Europe/Zagreb';
const DEFAULT = { windowMinutes: 30, from: '08:00', to: '21:00' };
const CAP_MS = RESPONSE_WINDOW_CAP_HOURS * 3_600_000;

function due(local: string, hours = DEFAULT, zone = ZONE): string {
  return toLocalDateTime(responseDueAt(fromLocalDateTime(local, zone), hours, zone), zone);
}

describe('responseDueAt', () => {
  it('counts the window inside response hours', () => {
    expect(due('2026-11-10T10:00')).toBe('2026-11-10T10:30');
  });

  it('carries the rest of the window across the 21:00 boundary', () => {
    expect(due('2026-11-10T20:50')).toBe('2026-11-11T08:20');
  });

  it('starts at the next opening after hours', () => {
    expect(due('2026-11-10T21:30')).toBe('2026-11-11T08:30');
  });

  it('starts at the opening early in the morning', () => {
    expect(due('2026-11-10T07:00')).toBe('2026-11-10T08:30');
  });

  it('reads pg time values with seconds', () => {
    expect(due('2026-11-10T20:50', { windowMinutes: 30, from: '08:00:00', to: '21:00:00' })).toBe(
      '2026-11-11T08:20',
    );
  });

  it('ends the longest allowed window under 96 h', () => {
    const requested = fromLocalDateTime('2026-11-10T21:01', ZONE);
    const hours = {
      windowMinutes: maxResponseWindowMinutes('08:00', '21:00'),
      from: '08:00',
      to: '21:00',
    };
    const result = responseDueAt(requested, hours, ZONE);
    expect(result.getTime() - requested.getTime()).toBeLessThan(CAP_MS);
  });

  it('stays within 96 h across the spring-forward day', () => {
    const requested = fromLocalDateTime('2027-03-28T00:00', ZONE);
    const hours = {
      windowMinutes: maxResponseWindowMinutes('00:00', '23:59'),
      from: '00:00',
      to: '23:59',
    };
    const result = responseDueAt(requested, hours, ZONE);
    expect(result.getTime() - requested.getTime()).toBeLessThanOrEqual(CAP_MS);
  });

  it('clamps a window that would run past 96 h', () => {
    const requested = fromLocalDateTime('2026-11-10T10:00', ZONE);
    const result = responseDueAt(
      requested,
      { windowMinutes: 10_000, from: '08:00', to: '21:00' },
      ZONE,
    );
    expect(result.getTime() - requested.getTime()).toBe(CAP_MS);
  });

  it('crosses the autumn DST change on local time', () => {
    expect(due('2026-10-24T20:50')).toBe('2026-10-25T08:20');
  });

  it('uses the property zone it is given', () => {
    const requested = new Date('2026-11-11T01:50:00Z'); // 20:50 in New York
    expect(
      toLocalDateTime(responseDueAt(requested, DEFAULT, 'America/New_York'), 'America/New_York'),
    ).toBe('2026-11-11T08:20');
    expect(toLocalDateTime(responseDueAt(requested, DEFAULT, ZONE), ZONE)).toBe('2026-11-11T08:30');
  });
});

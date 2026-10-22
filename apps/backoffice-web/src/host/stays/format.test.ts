import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  dateRange,
  guestsLabel,
  nights,
  nightsLabel,
  PHASE_LABELS,
  releaseText,
} from './format';

describe('Stay labels', () => {
  it('formats a date range day first', () => {
    expect(dateRange('2026-10-21', '2026-10-24')).toBe('21 Oct – 24 Oct 2026');
  });

  it('shows both years when a Stay crosses New Year', () => {
    expect(dateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
  });

  it('counts nights across a DST change', () => {
    expect(nights('2026-10-24', '2026-10-27')).toBe(3);
    expect(nights('2026-03-28', '2026-03-30')).toBe(2);
    expect(nightsLabel('2026-10-24', '2026-10-25')).toBe('1 night');
    expect(nightsLabel('2026-10-24', '2026-10-27')).toBe('3 nights');
  });

  it('labels the phase, the release time and the party', () => {
    expect(PHASE_LABELS.in_stay).toBe('In stay');
    expect(releaseText('2026-10-20T00:00')).toBe('Arrival details from 20 Oct, 00:00');
    expect(guestsLabel(1)).toBe('1 guest');
    expect(guestsLabel(4)).toBe('4 guests');
  });

  it('says how long ago a calendar was checked', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    expect(agoLabel('2026-10-19T09:59:30Z', now)).toBe('just now');
    expect(agoLabel('2026-10-19T09:48:00Z', now)).toBe('12 min ago');
    expect(agoLabel('2026-10-19T07:00:00Z', now)).toBe('3 h ago');
    expect(agoLabel('2026-10-18T09:00:00Z', now)).toBe('1 day ago');
    expect(agoLabel('2026-10-16T09:00:00Z', now)).toBe('3 days ago');
  });
});

import { describe, expect, it } from 'vitest';
import { endOfCheckoutDay } from '../time';
import { situationOf } from './situation';

// Checkout day 2026-10-25 is the day Europe/Zagreb leaves summer time (UTC+2 → UTC+1).
const ZONE = 'Europe/Zagreb';
const stay = { checkIn: '2026-10-21', activeUntil: endOfCheckoutDay('2026-10-25', ZONE) };
const base = { stay, timezone: ZONE, destinationId: null, hostHasOwnOffers: false };
const phaseAt = (iso: string) => situationOf(base, new Date(iso)).phase;

describe('situationOf', () => {
  it('is before arrival until 00:00 of check-in day in the property zone', () => {
    expect(phaseAt('2026-10-20T21:59:59.999Z')).toBe('upcoming');
    expect(phaseAt('2026-10-20T22:00:00.000Z')).toBe('in_stay');
  });

  it('is after checkout from the end of checkout day, across the DST change', () => {
    expect(stay.activeUntil.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(phaseAt('2026-10-25T22:59:59.999Z')).toBe('in_stay');
    expect(phaseAt('2026-10-25T23:00:00.000Z')).toBe('ended');
  });

  it('passes the destination and own-Offers facts through', () => {
    const now = new Date('2026-10-22T10:00:00Z');
    expect(situationOf(base, now)).toEqual({
      phase: 'in_stay',
      insideDestination: false,
      hostHasOwnOffers: false,
    });
    expect(situationOf({ ...base, destinationId: 'd', hostHasOwnOffers: true }, now)).toMatchObject(
      { insideDestination: true, hostHasOwnOffers: true },
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { PropertySummary, Stay } from '../../api';
import { attentionItems, barSpan, calendarDays, dayHeading, movementsByDay } from './TodayPage';

const stay = (over: Partial<Stay>): Stay =>
  ({
    id: 's1',
    unitId: 'u1',
    unitName: 'Apartman Mirakul',
    checkIn: '2026-10-27',
    checkout: '2026-10-30',
    partySize: 2,
    bookerName: null,
    pinSentAt: null,
    pinWarning: false,
    phase: 'upcoming',
    ...over,
  }) as Stay;

const property = (over: Partial<PropertySummary>): PropertySummary => ({
  id: 'p1',
  name: 'Kuća Trogir',
  city: 'Trogir',
  approved: true,
  units: [{ id: 'u1', name: 'Apartman Mirakul', hasQr: true, live: true }],
  ...over,
});

const base = {
  properties: [property({})],
  stays: [],
  unread: 0,
  ordersWaiting: 0,
  proposals: 0,
  suggestions: 0,
};

describe('attentionItems', () => {
  it('is empty when nothing waits on the host', () => {
    expect(attentionItems(base)).toEqual([]);
  });

  it('lists messages, orders, PINs, proposals, setup and suggestions in that order', () => {
    const items = attentionItems({
      ...base,
      unread: 2,
      ordersWaiting: 1,
      proposals: 1,
      suggestions: 3,
      stays: [stay({ pinWarning: true })],
      properties: [property({ units: [{ id: 'u2', name: 'Studio', hasQr: false, live: false }] })],
    });
    expect(items.map((i) => i.key)).toEqual([
      'messages',
      'orders',
      'pin-s1',
      'proposals',
      'setup-u2',
      'suggestions',
    ]);
    expect(items[0]?.text).toBe('2 guest messages not read yet');
    expect(items[1]?.text).toBe('1 order waits for your answer');
    expect(items.find((i) => i.key === 'setup-u2')?.to).toBe('/units/u2/setup');
  });

  it('points to approval, not setup, while the property waits for approval', () => {
    const items = attentionItems({
      ...base,
      properties: [
        property({
          approved: false,
          units: [{ id: 'u2', name: 'Studio', hasQr: false, live: false }],
        }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual(['approval-p1']);
  });
});

describe('movementsByDay', () => {
  it('groups arrivals and departures by day, departures first', () => {
    const days = movementsByDay(
      [
        stay({ id: 'a', checkIn: '2026-10-27', checkout: '2026-10-30' }),
        stay({ id: 'b', checkIn: '2026-10-30', checkout: '2026-11-02' }),
      ],
      '2026-10-27',
    );
    expect(days.map(([d, ms]) => [d, ms.map((m) => `${m.kind}:${m.stay.id}`)])).toEqual([
      ['2026-10-27', ['arrival:a']],
      ['2026-10-30', ['departure:a', 'arrival:b']],
      ['2026-11-02', ['departure:b']],
    ]);
  });

  it('leaves out what happened before today or after two weeks', () => {
    const days = movementsByDay(
      [stay({ checkIn: '2026-10-20', checkout: '2026-11-20' })],
      '2026-10-27',
    );
    expect(days).toEqual([]);
  });
});

describe('dayHeading', () => {
  it('names today and tomorrow, and spells out later days', () => {
    expect(dayHeading('2026-10-27', '2026-10-27')).toBe('Today');
    expect(dayHeading('2026-10-28', '2026-10-27')).toBe('Tomorrow');
    expect(dayHeading('2026-10-30', '2026-10-27')).toBe('Friday 30 October');
  });
});

describe('calendarDays', () => {
  it('starts on the Monday of the current week and moves a week at a time', () => {
    // 27 October 2026 is a Tuesday.
    const now = calendarDays('2026-10-27', 0);
    expect(now).toHaveLength(14);
    expect(now[0]).toBe('2026-10-26');
    expect(now[13]).toBe('2026-11-08');
    expect(calendarDays('2026-10-27', 1)[0]).toBe('2026-11-02');
    expect(calendarDays('2026-10-27', -1)[0]).toBe('2026-10-19');
  });

  it('keeps a Sunday in the week that ends on it', () => {
    expect(calendarDays('2026-11-01', 0)[0]).toBe('2026-10-26');
  });
});

describe('barSpan', () => {
  const days = calendarDays('2026-10-27', 0); // 26 Oct to 8 Nov

  it('runs from midday of check-in to midday of checkout', () => {
    // 27 Oct is day 1 (columns 4-5), 30 Oct is day 4 (columns 10-11).
    expect(barSpan({ checkIn: '2026-10-27', checkout: '2026-10-30' }, days)).toEqual({
      start: 5,
      end: 11,
      cutStart: false,
      cutEnd: false,
    });
  });

  it('runs to the edges for a Stay that continues past the shown weeks', () => {
    expect(barSpan({ checkIn: '2026-10-20', checkout: '2026-11-20' }, days)).toEqual({
      start: 2,
      end: 30,
      cutStart: true,
      cutEnd: true,
    });
  });

  it('is null for a Stay with no night on screen', () => {
    expect(barSpan({ checkIn: '2026-10-20', checkout: '2026-10-26' }, days)).toBeNull();
    expect(barSpan({ checkIn: '2026-11-09', checkout: '2026-11-12' }, days)).toBeNull();
  });
});

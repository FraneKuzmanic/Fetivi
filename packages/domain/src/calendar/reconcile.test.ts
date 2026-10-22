import { describe, expect, it } from 'vitest';
import type { ParsedEvent } from './ical';
import { type KnownEvent, plan, type UnitStay } from './reconcile';

const ZONE = 'Europe/Zagreb';
const NOW = new Date('2026-10-19T10:00:00Z');

const ev = (uid: string, checkIn: string, checkout: string, extra: Partial<ParsedEvent> = {}) =>
  ({ uid, checkIn, checkout, summary: 'Reserved', cancelled: false, ...extra }) as ParsedEvent;

const known = (
  id: string,
  status: KnownEvent['status'],
  checkIn: string,
  checkout: string,
  extra: Partial<KnownEvent> = {},
): KnownEvent => ({
  id,
  uid: `uid-${id}`,
  checkIn,
  checkout,
  summary: 'Reserved',
  status,
  stayId: status === 'confirmed' ? `stay-${id}` : null,
  vanishedAt: null,
  ...extra,
});

const stay = (id: string, checkIn: string, checkout: string, extra: Partial<UnitStay> = {}) => ({
  id,
  checkIn,
  checkout,
  possiblyCancelled: false,
  presentLinkedEventIds: [],
  ...extra,
});

const run = (k: KnownEvent[], fetched: ParsedEvent[], stays: UnitStay[] = []) =>
  plan({ known: k, fetched, stays, zone: ZONE, now: NOW });

const types = (actions: ReturnType<typeof plan>) => actions.map((a) => a.type).sort();

describe('plan', () => {
  it('proposes a new event', () => {
    expect(run([], [ev('a', '2026-10-24', '2026-10-27')])).toEqual([
      {
        type: 'insert',
        uid: 'a',
        checkIn: '2026-10-24',
        checkout: '2026-10-27',
        summary: 'Reserved',
        status: 'pending',
        stayId: null,
      },
    ]);
  });

  it('keeps a dismissed event dismissed, also after a date change', () => {
    const d = known('d', 'dismissed', '2026-10-24', '2026-10-27');
    expect(run([d], [ev('uid-d', '2026-10-24', '2026-10-27')])).toEqual([
      { type: 'touch', id: 'd' },
    ]);
    expect(types(run([d], [ev('uid-d', '2026-10-25', '2026-10-28')]))).toEqual(['update']);
  });

  it('updates a pending event whose dates changed', () => {
    const p = known('p', 'pending', '2026-10-24', '2026-10-27');
    expect(run([p], [ev('uid-p', '2026-10-25', '2026-10-28')])).toEqual([
      {
        type: 'update',
        id: 'p',
        checkIn: '2026-10-25',
        checkout: '2026-10-28',
        summary: 'Reserved',
      },
    ]);
  });

  it('moves the Stay of a confirmed event whose dates changed', () => {
    const c = known('c', 'confirmed', '2026-10-24', '2026-10-27');
    const actions = run(
      [c],
      [ev('uid-c', '2026-10-25', '2026-10-29')],
      [stay('stay-c', '2026-10-24', '2026-10-27')],
    );
    expect(actions).toContainEqual({
      type: 'moveStay',
      stayId: 'stay-c',
      checkIn: '2026-10-25',
      checkout: '2026-10-29',
    });
    expect(types(actions)).toEqual(['moveStay', 'update']);
  });

  it('does not move a Stay that already has the new dates', () => {
    const c = known('c', 'confirmed', '2026-10-24', '2026-10-27');
    const actions = run(
      [c],
      [ev('uid-c', '2026-10-25', '2026-10-29')],
      [stay('stay-c', '2026-10-25', '2026-10-29')],
    );
    expect(types(actions)).toEqual(['update']);
  });

  it('deletes a pending event that vanished', () => {
    expect(run([known('p', 'pending', '2026-10-24', '2026-10-27')], [])).toEqual([
      { type: 'delete', id: 'p' },
    ]);
  });

  it('keeps a vanished dismissed event without action', () => {
    expect(run([known('d', 'dismissed', '2026-10-24', '2026-10-27')], [])).toEqual([]);
  });

  it('flags the Stay of a confirmed event that vanished', () => {
    const actions = run(
      [known('c', 'confirmed', '2026-10-24', '2026-10-27')],
      [],
      [stay('stay-c', '2026-10-24', '2026-10-27')],
    );
    expect(actions).toEqual([
      { type: 'vanish', id: 'c' },
      { type: 'flagPossiblyCancelled', stayId: 'stay-c' },
    ]);
  });

  it('does not flag a Stay that has already started', () => {
    const actions = run(
      [known('c', 'confirmed', '2026-10-17', '2026-10-21')],
      [],
      [stay('stay-c', '2026-10-17', '2026-10-21')],
    );
    expect(actions).toEqual([{ type: 'vanish', id: 'c' }]);
  });

  it('does not flag a Stay another feed still shows', () => {
    const actions = run(
      [known('c', 'confirmed', '2026-10-24', '2026-10-27')],
      [],
      [stay('stay-c', '2026-10-24', '2026-10-27', { presentLinkedEventIds: ['other'] })],
    );
    expect(actions).toEqual([{ type: 'vanish', id: 'c' }]);
  });

  it('clears the flag when a vanished event reappears', () => {
    const c = known('c', 'confirmed', '2026-10-24', '2026-10-27', { vanishedAt: NOW });
    const actions = run(
      [c],
      [ev('uid-c', '2026-10-24', '2026-10-27')],
      [stay('stay-c', '2026-10-24', '2026-10-27', { possiblyCancelled: true })],
    );
    expect(types(actions)).toEqual(['clearPossiblyCancelled', 'reappear', 'touch']);
  });

  it('pairs a UID change with the same dates: linked, old row deleted, no move, no flag', () => {
    const actions = run(
      [known('c', 'confirmed', '2026-10-24', '2026-10-27')],
      [ev('new-uid', '2026-10-24', '2026-10-27')],
      [stay('stay-c', '2026-10-24', '2026-10-27')],
    );
    expect(actions).toEqual([
      { type: 'delete', id: 'c' },
      {
        type: 'insert',
        uid: 'new-uid',
        checkIn: '2026-10-24',
        checkout: '2026-10-27',
        summary: 'Reserved',
        status: 'confirmed',
        stayId: 'stay-c',
      },
    ]);
  });

  it('pairs a UID change with new dates and moves the Stay', () => {
    const actions = run(
      [known('c', 'confirmed', '2026-10-24', '2026-10-27')],
      [ev('new-uid', '2026-10-25', '2026-10-29')],
      [stay('stay-c', '2026-10-24', '2026-10-27')],
    );
    expect(types(actions)).toEqual(['delete', 'insert', 'moveStay']);
    expect(actions).toContainEqual({
      type: 'moveStay',
      stayId: 'stay-c',
      checkIn: '2026-10-25',
      checkout: '2026-10-29',
    });
  });

  it('does not pair when two bookings vanished and two appeared', () => {
    const actions = run(
      [
        known('a', 'confirmed', '2026-10-24', '2026-10-27'),
        known('b', 'confirmed', '2026-11-02', '2026-11-05'),
      ],
      [ev('n1', '2026-10-25', '2026-10-28'), ev('n2', '2026-11-03', '2026-11-06')],
      [stay('stay-a', '2026-10-24', '2026-10-27'), stay('stay-b', '2026-11-02', '2026-11-05')],
    );
    expect(types(actions)).toEqual([
      'flagPossiblyCancelled',
      'flagPossiblyCancelled',
      'insert',
      'insert',
      'vanish',
      'vanish',
    ]);
    expect(actions.filter((a) => a.type === 'insert').map((a) => a.status)).toEqual([
      'pending',
      'pending',
    ]);
  });

  it('links a new event whose dates equal an active Stay', () => {
    const actions = run(
      [],
      [ev('a', '2026-10-24', '2026-10-27')],
      [stay('manual', '2026-10-24', '2026-10-27')],
    );
    expect(actions).toMatchObject([{ type: 'insert', status: 'confirmed', stayId: 'manual' }]);
  });

  it('treats unusable events as absent', () => {
    const p = known('p', 'pending', '2026-10-24', '2026-10-27');
    const fetched = [
      ev('long', '2026-10-24', '2027-02-01'),
      ev('ended', '2026-10-10', '2026-10-15'),
      ev('far', '2028-12-01', '2028-12-05'),
      ev('uid-p', '2026-10-24', '2026-10-27', { cancelled: true }),
    ];
    expect(run([p], fetched)).toEqual([{ type: 'delete', id: 'p' }]);
  });
});

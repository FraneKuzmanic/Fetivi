import { describe, expect, it } from 'vitest';
import {
  awaitingAcceptanceOf,
  cancellationTermsAt,
  lateChargePercent,
  orderStart,
  refundFor,
} from './refunds';
import { ORDER_STATUSES } from './vocabulary';

const startsAt = new Date('2026-10-25T16:00:00Z');
const cutoff = new Date('2026-10-24T16:00:00Z');
const rule = { freeCancelHoursBefore: 24, refundPercentAfter: 50, amountMinor: 9000, startsAt };
const at = (offsetMs: number) => new Date(cutoff.getTime() + offsetMs);

describe('refundFor', () => {
  it('refunds in full before the cutoff', () => {
    expect(refundFor({ ...rule, now: at(-1) })).toEqual({
      percent: 100,
      amountMinor: 9000,
      cutoff,
      free: true,
    });
  });

  it('is still free exactly at the cutoff', () => {
    expect(refundFor({ ...rule, now: at(0) })).toMatchObject({ percent: 100, amountMinor: 9000 });
  });

  it('refunds the percentage after the cutoff', () => {
    expect(refundFor({ ...rule, now: at(1) })).toEqual({
      percent: 50,
      amountMinor: 4500,
      cutoff,
      free: false,
    });
  });

  it('measures a zero-hour rule from the start itself', () => {
    const quote = refundFor({
      ...rule,
      freeCancelHoursBefore: 0,
      now: new Date(startsAt.getTime() - 1),
    });
    expect(quote).toMatchObject({ percent: 100, free: true, cutoff: startsAt });
  });

  it('refunds nothing under a 0 % rule after the cutoff', () => {
    expect(refundFor({ ...rule, refundPercentAfter: 0, now: at(1) })).toMatchObject({
      percent: 0,
      amountMinor: 0,
    });
  });

  it('rounds down', () => {
    expect(refundFor({ ...rule, amountMinor: 999, now: at(1) }).amountMinor).toBe(499);
  });
});

describe('orderStart', () => {
  it('uses the proposal start when there is one', () => {
    expect(orderStart({ date: '2026-10-25', startsAt }, 'Europe/Zagreb')).toEqual(startsAt);
  });

  it('falls back to local midnight in the property zone', () => {
    expect(orderStart({ date: '2026-07-10', startsAt: null }, 'Europe/Zagreb')).toEqual(
      new Date('2026-07-09T22:00:00Z'),
    );
  });

  it('is correct on a DST change day', () => {
    // 2026-10-25 is the day Zagreb leaves summer time; midnight is still +02:00.
    expect(orderStart({ date: '2026-10-25', startsAt: null }, 'Europe/Zagreb')).toEqual(
      new Date('2026-10-24T22:00:00Z'),
    );
    // 2026-03-29 springs forward at 02:00; midnight is +01:00.
    expect(orderStart({ date: '2026-03-29', startsAt: null }, 'Europe/Zagreb')).toEqual(
      new Date('2026-03-28T23:00:00Z'),
    );
  });
});

describe('cancellationTermsAt', () => {
  const policy = { freeCancelHoursBefore: 24, lateChargePercent: 50 };

  it('is free before the cutoff, with the cutoff in UTC and local time', () => {
    expect(cancellationTermsAt(policy, startsAt, 'Europe/Zagreb', at(-1))).toEqual({
      freeCancelHoursBefore: 24,
      lateChargePercent: 50,
      freeUntil: '2026-10-24T16:00:00.000Z',
      freeUntilLocal: '2026-10-24T18:00',
      freeWindowPassed: false,
      awaitingAcceptance: null,
    });
  });

  it('is still free exactly at the cutoff', () => {
    expect(cancellationTermsAt(policy, startsAt, 'Europe/Zagreb', at(0)).freeWindowPassed).toBe(
      false,
    );
  });

  it('has passed after the cutoff', () => {
    expect(cancellationTermsAt(policy, startsAt, 'Europe/Zagreb', at(1)).freeWindowPassed).toBe(
      true,
    );
  });

  it('keeps 0 % and 100 % late charges as they are', () => {
    expect(
      cancellationTermsAt({ ...policy, lateChargePercent: 0 }, startsAt, 'UTC', at(1))
        .lateChargePercent,
    ).toBe(0);
    expect(
      cancellationTermsAt({ ...policy, lateChargePercent: 100 }, startsAt, 'UTC', at(1))
        .lateChargePercent,
    ).toBe(100);
  });

  it('stays free after the cutoff while a request awaits acceptance', () => {
    expect(cancellationTermsAt(policy, startsAt, 'Europe/Zagreb', at(1), 'host')).toMatchObject({
      freeWindowPassed: false,
      awaitingAcceptance: 'host',
      freeUntil: '2026-10-24T16:00:00.000Z',
    });
  });
});

describe('awaitingAcceptanceOf', () => {
  it('names the owner while an on-request Order is not yet accepted', () => {
    const awaiting = new Set(['awaiting_confirmation', 'confirming', 'pending_provider']);
    for (const status of ORDER_STATUSES) {
      expect(awaitingAcceptanceOf({ availabilityMode: 'on_request', status }, 'provider')).toBe(
        awaiting.has(status) ? 'provider' : null,
      );
    }
  });

  it('is null for instant bookings', () => {
    for (const status of ORDER_STATUSES) {
      expect(awaitingAcceptanceOf({ availabilityMode: 'allotment', status }, 'host')).toBeNull();
    }
  });
});

describe('lateChargePercent', () => {
  it('is the share that is not refunded', () => {
    expect(lateChargePercent(50)).toBe(50);
    expect(lateChargePercent(0)).toBe(100);
    expect(lateChargePercent(100)).toBe(0);
  });
});

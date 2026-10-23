import { describe, expect, it } from 'vitest';
import { orderStart, refundFor } from './refunds';

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

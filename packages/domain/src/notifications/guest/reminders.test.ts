import { describe, expect, it } from 'vitest';
import { checkoutReminderAt, orderReminderAt } from './reminders';

const ZAGREB = 'Europe/Zagreb';

describe('evening-before reminders', () => {
  it('is 18:00 Zagreb the day before', () => {
    expect(orderReminderAt('2027-07-14', ZAGREB).toISOString()).toBe('2027-07-13T16:00:00.000Z');
    expect(checkoutReminderAt('2027-07-14', ZAGREB).toISOString()).toBe('2027-07-13T16:00:00.000Z');
  });

  it('stays at 18:00 local across the spring change (28 March 2027)', () => {
    expect(orderReminderAt('2027-03-28', ZAGREB).toISOString()).toBe('2027-03-27T17:00:00.000Z');
    expect(orderReminderAt('2027-03-29', ZAGREB).toISOString()).toBe('2027-03-28T16:00:00.000Z');
  });

  it('stays at 18:00 local across the autumn change (31 October 2027)', () => {
    expect(orderReminderAt('2027-10-31', ZAGREB).toISOString()).toBe('2027-10-30T16:00:00.000Z');
    expect(orderReminderAt('2027-11-01', ZAGREB).toISOString()).toBe('2027-10-31T17:00:00.000Z');
  });

  it('crosses month and year starts', () => {
    expect(orderReminderAt('2027-05-01', ZAGREB).toISOString()).toBe('2027-04-30T16:00:00.000Z');
    expect(checkoutReminderAt('2027-01-01', ZAGREB).toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});

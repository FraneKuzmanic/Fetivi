import { DateTime } from 'luxon';

/** The structured part of a cancellation policy, snapshotted on the Order. */
export interface RefundRule {
  freeCancelHoursBefore: number;
  refundPercentAfter: number;
}

export interface RefundQuote {
  percent: number;
  amountMinor: number;
  cutoff: Date;
  free: boolean;
}

const HOUR_MS = 3_600_000;

/** The refund the snapshotted rules give at `now`; the policy text is never read. */
export function refundFor(
  input: RefundRule & { amountMinor: number; startsAt: Date; now: Date },
): RefundQuote {
  const cutoff = new Date(input.startsAt.getTime() - input.freeCancelHoursBefore * HOUR_MS);
  // Cancelling exactly at the cutoff is still free.
  const free = input.now.getTime() <= cutoff.getTime();
  const percent = free ? 100 : input.refundPercentAfter;
  // Rounded down, like the application fee: never more than the policy gives.
  const amountMinor = Math.floor((input.amountMinor * percent) / 100);
  return { percent, amountMinor, cutoff, free };
}

/** When an Order starts: the proposal's start, else the start of its civil day in the property zone. */
export function orderStart(proposal: { date: string; startsAt: Date | null }, zone: string): Date {
  if (proposal.startsAt) return proposal.startsAt;
  return DateTime.fromISO(proposal.date, { zone }).startOf('day').toJSDate();
}

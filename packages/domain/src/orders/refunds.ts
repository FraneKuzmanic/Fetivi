import { z } from 'zod';
import { type CivilDate, startOfCivilDay, toLocalDateTime } from '../time';

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
  return startOfCivilDay(proposal.date as CivilDate, zone);
}

/** What cancelling costs, as the guest is told it; the policy text is never read. */
export interface LateChargeRule {
  freeCancelHoursBefore: number;
  /** The share of the price the guest loses after the free window. */
  lateChargePercent: number;
}

export interface CancellationTerms extends LateChargeRule {
  /** ISO instant free cancellation ends. */
  freeUntil: string;
  /** 'YYYY-MM-DDTHH:mm' in the property's zone. */
  freeUntilLocal: string;
  freeWindowPassed: boolean;
}

/** Stored on card drafts; mirrored by the UI payloads. */
export const cancellationTermsSchema = z.object({
  freeCancelHoursBefore: z.number().int(),
  lateChargePercent: z.number().int().min(0).max(100),
  freeUntil: z.string(),
  freeUntilLocal: z.string(),
  freeWindowPassed: z.boolean(),
});

/**
 * The share of the price the guest loses after the free window: 100 − the refunded share. Said
 * this way, it reads right for direct pay too, where nothing is ever refunded.
 */
export const lateChargePercent = (refundPercentAfter: number) => 100 - refundPercentAfter;

/** The terms at `now` for an Order or draft starting at `start`; the same cutoff as `refundFor`. */
export function cancellationTermsAt(
  policy: LateChargeRule,
  start: Date,
  zone: string,
  now: Date,
): CancellationTerms {
  const cutoff = new Date(start.getTime() - policy.freeCancelHoursBefore * HOUR_MS);
  return {
    freeCancelHoursBefore: policy.freeCancelHoursBefore,
    lateChargePercent: policy.lateChargePercent,
    freeUntil: cutoff.toISOString(),
    freeUntilLocal: toLocalDateTime(cutoff, zone),
    // Cancelling exactly at the cutoff is still free.
    freeWindowPassed: now.getTime() > cutoff.getTime(),
  };
}

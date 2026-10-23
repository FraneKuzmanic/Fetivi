import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client';
import { orderProposals, orders, paymentAttempts } from '../../db/schema/orders';
import { pendingActions } from '../../db/schema/pending-actions';
import { properties, units } from '../../db/schema/properties';
import { stays } from '../../db/schema/stays';
import { PAYMENT_MODES } from '../../offers/vocabulary';
import { cancel, type OrderDeps } from '../../orders/machine';
import { orderStart, refundFor } from '../../orders/refunds';
import {
  isFinalOrderStatus,
  type OrderStatus,
  PAYMENT_STATUSES,
  UNRESOLVED_ORDER_STATUSES,
} from '../../orders/vocabulary';
import { GUEST_LANGUAGES, type GuestLanguage } from '../../property/vocabulary';
import { stayPhase } from '../../stays/rules';
import { type CivilDate, toLocalDateTime } from '../../time';
import { getSpaceOrder, type OrderSummary } from './create-order';
import { insertPending, lockPending, markPending } from './store';
import { PENDING_TTL_SECONDS, type PendingState } from './vocabulary';

// The `cancel_order` halves (35). The first half computes the refund from the rules snapshotted on
// the Order and stores it with the card; the guest's tap recomputes it and cancels only when it is
// still the amount the card showed. The policy text is shown, never used for the amount.
// Lock order: pending row, then the machine's (Order, attempt, slot).

/** The stored cancel draft: everything the cancel card shows. */
export const cancelOrderPayload = z.object({
  orderId: z.uuid(),
  /** The proposal the card was shown for; a newer one makes the tap a refusal. */
  proposalId: z.uuid(),
  offerTitle: z.string(),
  language: z.enum(GUEST_LANGUAGES),
  date: z.string(),
  /** 'YYYY-MM-DDTHH:mm' in the property's zone. */
  startsAtLocal: z.string().nullable(),
  quantity: z.number().int(),
  paymentMode: z.enum(PAYMENT_MODES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  priceMinor: z.number().int().nullable(),
  currency: z.string(),
  cancellationPolicy: z.string(),
  /** What goes back to the guest, in cents; null when nothing is refunded through Fetivi. */
  refundMinor: z.number().int().nullable(),
  refundPercent: z.number().int().nullable(),
  /** ISO instant of the free-cancellation cutoff, for a captured Order. */
  freeUntil: z.string().nullable(),
  /** The cutoff as 'YYYY-MM-DDTHH:mm' in the property's zone. */
  freeUntilLocal: z.string().nullable(),
});
export type CancelOrderDraft = z.infer<typeof cancelOrderPayload>;

type Refund = Pick<
  CancelOrderDraft,
  'refundMinor' | 'refundPercent' | 'freeUntil' | 'freeUntilLocal'
>;

/** Why a cancel is refused; `not-found` covers another space's Order. */
export type CancelRuleCode =
  | 'not-found'
  | 'not-cancellable'
  | 'being-confirmed'
  | 'started'
  | 'after-checkout'
  | 'expired'
  | 'released';

export class CancelRuleError extends Error {
  override name = 'CancelRuleError';
  constructor(readonly code: CancelRuleCode) {
    super(code);
  }
}

async function loadCancel(db: Executor, spaceId: string, orderId: string) {
  const [row] = await db
    .select({
      order: orders,
      proposal: orderProposals,
      attempt: paymentAttempts,
      zone: properties.timezone,
      checkIn: stays.checkIn,
      activeUntil: stays.activeUntil,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .leftJoin(paymentAttempts, eq(paymentAttempts.proposalId, orders.currentProposalId))
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(orders.id, orderId), eq(orders.spaceId, spaceId)));
  return row;
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadCancel>>>;

/**
 * Who may cancel what (authorization matrix, `orders:manage`): an unresolved Order at any time;
 * a confirmed one before checkout and before its start. Null when the cancel is allowed.
 */
function refusal(row: Loaded, now: Date): CancelRuleCode | null {
  const { status } = row.order;
  if (isFinalOrderStatus(status)) return 'not-cancellable';
  if (status === 'confirming') return 'being-confirmed';
  if ((UNRESOLVED_ORDER_STATUSES as readonly OrderStatus[]).includes(status)) return null;
  const stay = { checkIn: row.checkIn as CivilDate, activeUntil: row.activeUntil };
  if (stayPhase(stay, row.zone, now) === 'ended') return 'after-checkout';
  if (orderStart(row.proposal, row.zone) <= now) return 'started';
  return null;
}

/**
 * What the cancel returns at `now`: the policy amount of a capture, the whole authorization
 * (it is voided, never charged), nothing for a pay-direct Order or one with no money yet.
 */
function refundAt(row: Loaded, now: Date): Refund {
  const none: Refund = {
    refundMinor: null,
    refundPercent: null,
    freeUntil: null,
    freeUntilLocal: null,
  };
  const { order, attempt } = row;
  if (order.paymentMode !== 'online' || !attempt) return none;
  if (order.paymentStatus === 'authorized') {
    return { ...none, refundMinor: attempt.amountMinor, refundPercent: 100 };
  }
  if (order.paymentStatus !== 'captured') return none;
  const quote = refundFor({
    amountMinor: attempt.amountMinor,
    startsAt: orderStart(row.proposal, row.zone),
    freeCancelHoursBefore: order.freeCancelHoursBefore,
    refundPercentAfter: order.refundPercentAfter,
    now,
  });
  return {
    refundMinor: quote.amountMinor,
    refundPercent: quote.percent,
    freeUntil: quote.cutoff.toISOString(),
    freeUntilLocal: toLocalDateTime(quote.cutoff, row.zone),
  };
}

/**
 * The first half: checks the Order may be cancelled, computes the refund and stores a pending
 * record bound to the space, valid for PENDING_TTL_SECONDS. Nothing changes until the tap.
 */
export async function prepareCancel(
  deps: { db: Executor; now: () => Date },
  ctx: { spaceId: string; language: GuestLanguage },
  input: { orderId: string },
): Promise<{ pendingId: string; draft: CancelOrderDraft }> {
  const now = deps.now();
  const row = await loadCancel(deps.db, ctx.spaceId, input.orderId);
  const summary =
    row && (await getSpaceOrder(deps.db, ctx.spaceId, ctx.language, row.order.id, now));
  if (!row || !summary) throw new CancelRuleError('not-found');
  const refused = refusal(row, now);
  if (refused) throw new CancelRuleError(refused);
  const draft: CancelOrderDraft = {
    orderId: row.order.id,
    proposalId: row.proposal.id,
    offerTitle: summary.offerTitle,
    language: ctx.language,
    date: row.proposal.date,
    startsAtLocal: summary.startsAtLocal,
    quantity: row.proposal.quantity,
    paymentMode: row.order.paymentMode,
    paymentStatus: row.order.paymentStatus,
    priceMinor: row.proposal.priceMinor,
    currency: row.proposal.currency,
    cancellationPolicy: row.order.cancellationPolicy,
    ...refundAt(row, now),
  };
  // The Order id stays in the payload: `order_id` belongs to create_order records.
  const pending = await insertPending(deps.db, {
    kind: 'cancel_order',
    spaceId: ctx.spaceId,
    stayId: row.order.stayId,
    payload: draft,
    expiresAt: new Date(now.getTime() + PENDING_TTL_SECONDS * 1000),
    now,
  });
  return { pendingId: pending.id, draft };
}

/** A pending `cancel_order` record of this space with its draft; null when it is not one. */
export async function getPendingCancel(
  db: Executor,
  pendingId: string,
  spaceId: string,
): Promise<{ state: PendingState; expiresAt: Date; draft: CancelOrderDraft } | null> {
  const [row] = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.spaceId, spaceId)));
  if (row?.kind !== 'cancel_order') return null;
  return {
    state: row.state,
    expiresAt: row.expiresAt,
    draft: cancelOrderPayload.parse(row.payload),
  };
}

export type CancelCompletion =
  | { outcome: 'cancelled'; order: OrderSummary; replay: boolean }
  /** The refund changed since the card was shown (the cutoff passed): show this draft instead. */
  | { outcome: 'changed'; draft: CancelOrderDraft };

type Step =
  | { kind: 'done'; draft: CancelOrderDraft; replay: boolean }
  | { kind: 'changed'; draft: CancelOrderDraft }
  | { kind: 'refused'; code: CancelRuleCode };

/**
 * The second half, on the guest's tap. In one transaction: the pending record is locked, the
 * refund recomputed, and the record consumed together with the machine's cancel (a savepoint),
 * which refunds the amount the card showed. A different amount re-asks without cancelling. A
 * repeat finds the record consumed and returns the same Order.
 */
export async function completeCancel(
  deps: OrderDeps,
  input: { pendingId: string; spaceId: string },
): Promise<CancelCompletion> {
  // Refusals are returned from the transaction, not thrown, so a release is not rolled back.
  const step = await deps.db.transaction(async (tx): Promise<Step> => {
    const row = await lockPending(tx, input.pendingId);
    if (!row || row.spaceId !== input.spaceId || row.kind !== 'cancel_order') {
      return { kind: 'refused', code: 'not-found' };
    }
    const draft = cancelOrderPayload.parse(row.payload);
    if (row.state === 'consumed') return { kind: 'done', draft, replay: true };
    if (row.state === 'released') return { kind: 'refused', code: 'released' };
    const now = deps.now();
    const refuse = async (code: CancelRuleCode): Promise<Step> => {
      await markPending(tx, row.id, 'released', now);
      return { kind: 'refused', code };
    };
    if (row.expiresAt <= now) return refuse('expired');

    // The Order row lock first, so the status and payment read here are what the cancel sees.
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, draft.orderId))
      .for('update');
    const current = await loadCancel(tx, input.spaceId, draft.orderId);
    if (!current) return refuse('not-found');
    // Another card or the admin cancelled it already: the guest's wish holds, nothing more to do.
    if (current.order.status === 'cancelled') {
      await markPending(tx, row.id, 'consumed', now);
      return { kind: 'done', draft, replay: true };
    }
    if (current.proposal.id !== draft.proposalId) return refuse('not-cancellable');
    const refused = refusal(current, now);
    if (refused) return refuse(refused);

    const refund = refundAt(current, now);
    if (refund.refundMinor !== draft.refundMinor) {
      const next: CancelOrderDraft = {
        ...draft,
        paymentStatus: current.order.paymentStatus,
        ...refund,
      };
      // The next tap is compared with what the guest now sees, on a fresh card.
      await tx
        .update(pendingActions)
        .set({ payload: next, expiresAt: new Date(now.getTime() + PENDING_TTL_SECONDS * 1000) })
        .where(eq(pendingActions.id, row.id));
      return { kind: 'changed', draft: next };
    }

    const captured = current.order.paymentStatus === 'captured';
    const result = await cancel(
      { db: tx, queue: deps.queue, now: deps.now },
      {
        orderId: draft.orderId,
        proposalId: draft.proposalId,
        trigger: 'guest',
        refundMinor: captured ? (refund.refundMinor ?? undefined) : undefined,
        note: captured && refund.refundMinor === 0 ? 'refund 0 (policy)' : undefined,
      },
    );
    if (result.outcome !== 'applied' && result.outcome !== 'unchanged') {
      return refuse('not-cancellable');
    }
    await markPending(tx, row.id, 'consumed', now);
    return { kind: 'done', draft, replay: false };
  });
  if (step.kind === 'refused') throw new CancelRuleError(step.code);
  if (step.kind === 'changed') return { outcome: 'changed', draft: step.draft };
  const order = await getSpaceOrder(
    deps.db,
    input.spaceId,
    step.draft.language,
    step.draft.orderId,
    deps.now(),
  );
  if (!order) throw new CancelRuleError('not-found');
  return { outcome: 'cancelled', order, replay: step.replay };
}

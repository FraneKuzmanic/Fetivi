import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';
import { allotmentSlots, offers } from '../db/schema/offers';
import {
  inventoryHolds,
  type OrderProposalRow,
  type OrderRow,
  orderEvents,
  orderProposals,
  orders,
  type PaymentAttemptRow,
  paymentAttempts,
} from '../db/schema/orders';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { JobQueue } from '../jobs/queue';
import { enqueueGuestNotification } from '../notifications/guest/enqueue';
import { orderReminderAt } from '../notifications/guest/reminders';
import { lockOfferRow } from '../offers/translation';
import { OFFER_LIMITS } from '../offers/vocabulary';
import { enqueuePaymentJob } from '../payments/enqueue';
import { applicationFee } from '../payments/keys';
import { merchantOf } from '../payments/merchant';
import { PAYMENT_LOCALES } from '../payments/vocabulary';
import { allotmentAdapter, restoreSeats } from '../services/adapters/allotment';
import { AdapterError } from '../services/adapters/interface';
import { type CivilDate, endOfCivilDay, toLocalDateTime } from '../time';
import { responseDueAt } from './response-window';
import {
  enqueueAdapterCancel,
  enqueueNotification,
  type OrderTimerJobData,
  scheduleTimer,
} from './timers';
import {
  actionTarget,
  asksProvider,
  nextPaymentStatus,
  nextStatus,
  type OrderAction,
  type PaymentAction,
  paymentActionTarget,
  requiredNotifications,
} from './transitions';
import type { OrderStatus, OrderTrigger, PaymentStatus, Proposer } from './vocabulary';

// The Order state machine: with `orders/payments.ts`, the only writer of `orders.status` and
// `orders.payment_status`.
// Every transition runs in one transaction that locks the Order row, writes the status and its
// OrderEvent, applies the hold and seat effects, and inserts the next jobs through the same
// transaction (confirmation also schedules the guest's reminder on guest-notify). Passing a
// transaction as `db` makes this a savepoint inside the caller's.
// Allotment seats are taken and returned through the allotment adapter, inside the machine's
// transaction. Lock order everywhere: Order row, then payment attempt row, then slot row
// (createOrder: Offer, then slot). Pay-direct Orders keep Payment status `none`. A pay-online
// Order (33) gets its payment attempt with its hold, is confirmed only once authorized, and every
// release enqueues what frees its money: void, refund or expiring the Checkout Session.
// On request (36): an Order waiting for the Provider holds nothing; entering `pending_provider`
// stores the response deadline on the proposal and schedules the window timer.

export interface OrderDeps {
  db: Executor;
  queue: JobQueue;
  now: () => Date;
}

/**
 * `applied` wrote the transition. Nothing is written otherwise: `unchanged` = already in the
 * action's target status (a duplicate); `stale` = the named proposal is not current, or a timer
 * that is not due or no longer applies; `rejected` = illegal from the current status.
 */
export type TransitionOutcome = {
  outcome: 'applied' | 'unchanged' | 'stale' | 'rejected';
  order: OrderRow;
};

export class OrderRuleError extends Error {
  override name = 'OrderRuleError';
  constructor(
    readonly code:
      | 'not-found'
      | 'invalid-input'
      | 'date-outside-stay'
      | 'payment-mode-unsupported'
      | 'payments-not-ready'
      | 'offer-inactive'
      | 'sold-out',
  ) {
    super(code);
  }
}

export interface HoldInput {
  expiresAt: Date;
  /** A live engine's hold reference (37). */
  externalRef?: string;
}

/** What the guest's confirmation needs: a hold whenever it leads to `confirming`. */
interface GuestConfirmInput {
  hold?: HoldInput;
}

export interface CreateOrderInput extends GuestConfirmInput {
  /** The order handle; a retry with the same id returns the existing Order. */
  id?: string;
  spaceId: string;
  offerId: string;
  date: CivilDate;
  startsAt?: Date;
  /** Required for allotment Offers: the slot to take seats from. */
  slotId?: string;
  quantity: number;
  contact: { email: string; name?: string; phone?: string };
}

export interface ActionInput {
  orderId: string;
  /** The proposal the action was shown for; an older one makes the action a no-op. */
  proposalId: string;
  trigger: OrderTrigger;
  /** The admin acting, for admin overrides. */
  actorId?: string;
  note?: string;
  /**
   * The refund of a captured Order, in minor units; default the full amount. Guest cancels pass
   * the policy amount, admin overrides their own.
   */
  refundMinor?: number;
}

const TIMER_TRIGGERS: readonly OrderTrigger[] = [
  'card_timer',
  'hold_timer',
  'window_timer',
  'completion_timer',
];

const isQuantity = (n: number) => Number.isInteger(n) && n >= 1 && n <= 999;

async function stayOfSpace(tx: Executor, spaceId: string) {
  const [row] = await tx
    .select({ stay: stays, zone: properties.timezone, language: spaces.language })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(spaces.id, spaceId));
  return row;
}

async function stayOfOrder(tx: Executor, order: OrderRow) {
  const row = await stayOfSpace(tx, order.spaceId);
  if (!row) throw new OrderRuleError('not-found');
  return row;
}

/** ISO civil dates compare correctly as strings. */
function assertWithinStay(date: CivilDate, stay: { checkIn: string; checkout: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OrderRuleError('invalid-input');
  if (date < stay.checkIn || date > stay.checkout) throw new OrderRuleError('date-outside-stay');
}

/** A slot of `offerId` that starts on `date` in the property's zone. */
async function assertSlot(
  tx: Executor,
  slotId: string,
  offerId: string,
  date: string,
  zone: string,
) {
  const [slot] = await tx.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  if (!slot || slot.offerId !== offerId) throw new OrderRuleError('invalid-input');
  if (toLocalDateTime(slot.startsAt, zone).slice(0, 10) !== date) {
    throw new OrderRuleError('invalid-input');
  }
  return slot;
}

export interface ChangeMeta {
  trigger: OrderTrigger;
  actorId?: string;
  note?: string;
}

/**
 * Writes the Order status, the Payment status or both, one OrderEvent with both from/to pairs,
 * and the notifications a status change requires.
 */
export async function writeChange(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  change: { status?: OrderStatus; paymentStatus?: PaymentStatus },
  proposalId: string,
  meta: ChangeMeta,
): Promise<OrderRow> {
  const now = deps.now();
  const status = change.status ?? order.status;
  const paymentStatus = change.paymentStatus ?? order.paymentStatus;
  const [updated] = await tx
    .update(orders)
    .set({ status, paymentStatus, updatedAt: now })
    .where(eq(orders.id, order.id))
    .returning();
  if (!updated) throw new OrderRuleError('not-found');
  await tx.insert(orderEvents).values({
    orderId: order.id,
    proposalId,
    fromStatus: order.status,
    toStatus: status,
    fromPaymentStatus: order.paymentStatus,
    toPaymentStatus: paymentStatus,
    trigger: meta.trigger,
    actorId: meta.actorId,
    note: meta.note,
    createdAt: now,
  });
  if (status !== order.status) {
    const kinds = requiredNotifications(order.status, status, meta.trigger, order.paymentMode);
    for (const kind of kinds) {
      await enqueueNotification(tx, deps.queue, { orderId: order.id, proposalId, kind });
    }
  }
  return updated;
}

/** Writes the status, its OrderEvent and the notifications the change requires. */
function writeStatus(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  to: OrderStatus,
  proposalId: string,
  meta: ChangeMeta,
): Promise<OrderRow> {
  return writeChange(tx, deps, order, { status: to }, proposalId, meta);
}

/**
 * Checks the Payment-status table and writes the change. Not legal now: `unchanged` when the
 * action by this trigger already led here, `rejected` otherwise.
 */
export async function writePayment(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  proposalId: string,
  action: PaymentAction,
  meta: ChangeMeta,
): Promise<TransitionOutcome> {
  const to = nextPaymentStatus(order.paymentStatus, action, meta.trigger);
  if (to === null) {
    const target = paymentActionTarget(action, meta.trigger);
    return { outcome: order.paymentStatus === target ? 'unchanged' : 'rejected', order };
  }
  const updated = await writeChange(tx, deps, order, { paymentStatus: to }, proposalId, meta);
  return { outcome: 'applied', order: updated };
}

/** The proposal's payment attempt, row-locked. Call after locking the Order, before any slot. */
export async function lockAttempt(
  tx: Tx,
  proposalId: string,
): Promise<PaymentAttemptRow | undefined> {
  const [attempt] = await tx
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.proposalId, proposalId))
    .for('update');
  return attempt;
}

/**
 * Captured money goes back: Payment `captured → refund_pending`, the amount stored on the attempt
 * before the refund job runs (a retry sends the same amount), and the job. A refund of 0 writes
 * only the amount: the money stays with the Provider under the policy, Payment stays `captured`.
 */
export async function requestRefundIn(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  attempt: PaymentAttemptRow,
  meta: ChangeMeta,
  amountMinor: number = attempt.amountMinor,
): Promise<TransitionOutcome> {
  if (!Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > attempt.amountMinor) {
    throw new OrderRuleError('invalid-input');
  }
  if (amountMinor === 0) {
    await tx
      .update(paymentAttempts)
      .set({ refundAmountMinor: 0, updatedAt: deps.now() })
      .where(eq(paymentAttempts.id, attempt.id));
    return { outcome: 'unchanged', order };
  }
  const result = await writePayment(tx, deps, order, attempt.proposalId, 'refund', meta);
  if (result.outcome === 'applied') {
    await tx
      .update(paymentAttempts)
      .set({ refundStatus: 'pending', refundAmountMinor: amountMinor, updatedAt: deps.now() })
      .where(eq(paymentAttempts.id, attempt.id));
    await enqueuePaymentJob(tx, deps.queue, attempt, 'refund');
  }
  return result;
}

/** Expires the attempt's Checkout Session when it may still be open: nothing was paid yet. */
async function expireOpenSession(tx: Tx, deps: OrderDeps, attempt: PaymentAttemptRow) {
  const mayBeOpen = attempt.sessionStatus === null || attempt.sessionStatus === 'open';
  if (attempt.createSentAt && mayBeOpen) {
    await enqueuePaymentJob(tx, deps.queue, attempt, 'expire_session');
  }
}

/**
 * What a released pay-online Order does with its money: an authorization is voided in full, a
 * Checkout Session that may be open is expired, and a capture is refunded by the cause of the
 * release: `refundMinor` when the caller decided it (the guest's policy amount, an admin
 * override), the full amount otherwise (Can't fulfil, an admin cancel, the payment paths).
 */
async function afterRelease(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  attempt: PaymentAttemptRow,
  meta: ActionInput,
): Promise<OrderRow> {
  switch (order.paymentStatus) {
    case 'authorized':
      await enqueuePaymentJob(tx, deps.queue, attempt, 'void');
      return order;
    case 'captured':
      return (
        await requestRefundIn(
          tx,
          deps,
          order,
          attempt,
          meta,
          meta.refundMinor ?? attempt.amountMinor,
        )
      ).order;
    case 'none':
      await expireOpenSession(tx, deps, attempt);
      return order;
    default:
      return order;
  }
}

/**
 * Locks the Order and its current proposal, then runs `body`. A proposal that is not current
 * is `stale` before `body` sees it.
 */
export async function withLockedOrder(
  deps: OrderDeps,
  orderId: string,
  proposalId: string,
  body: (tx: Tx, order: OrderRow, proposal: OrderProposalRow) => Promise<TransitionOutcome>,
): Promise<TransitionOutcome> {
  return deps.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw new OrderRuleError('not-found');
    if (order.currentProposalId !== proposalId) return { outcome: 'stale', order };
    const [proposal] = await tx
      .select()
      .from(orderProposals)
      .where(eq(orderProposals.id, proposalId));
    if (!proposal) throw new OrderRuleError('not-found');
    return body(tx, order, proposal);
  });
}

/**
 * Checks the table and writes the status change; the caller applies the effects. Not legal now:
 * `unchanged` when the same action by the same trigger already led here, `stale` for a timer that
 * no longer applies, `rejected` otherwise.
 */
async function transition(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  action: OrderAction,
  input: ActionInput,
  /** Only `guest_confirm` reads it: whether the Provider still has to say yes (`asksProvider`). */
  asks = false,
): Promise<TransitionOutcome> {
  const to = nextStatus(order.status, action, input.trigger, asks);
  if (to === null) {
    const target = actionTarget(action, input.trigger, asks);
    if (order.status === target) return { outcome: 'unchanged', order };
    return { outcome: TIMER_TRIGGERS.includes(input.trigger) ? 'stale' : 'rejected', order };
  }
  const updated = await writeStatus(tx, deps, order, to, input.proposalId, input);
  return { outcome: 'applied', order: updated };
}

async function currentHold(tx: Tx, proposalId: string) {
  const [hold] = await tx
    .select()
    .from(inventoryHolds)
    .where(eq(inventoryHolds.proposalId, proposalId));
  return hold;
}

/** Takes the proposal's seats and holds them until `hold.expiresAt`. Sold out throws. */
async function placeHold(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  proposal: OrderProposalRow,
  hold: HoldInput | undefined,
) {
  if (!hold) throw new OrderRuleError('invalid-input');
  if (proposal.slotId) {
    try {
      await allotmentAdapter.hold(
        { db: tx, now: deps.now },
        {
          orderId: order.id,
          proposalId: proposal.id,
          slotId: proposal.slotId,
          quantity: proposal.quantity,
          expiresAt: hold.expiresAt,
        },
      );
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'sold-out') {
        throw new OrderRuleError('sold-out');
      }
      throw error;
    }
  } else {
    await tx.insert(inventoryHolds).values({
      orderId: order.id,
      proposalId: proposal.id,
      externalRef: hold.externalRef,
      quantity: proposal.quantity,
      expiresAt: hold.expiresAt,
      createdAt: deps.now(),
    });
  }
  await scheduleTimer(
    tx,
    deps.queue,
    { orderId: order.id, proposalId: proposal.id, operation: 'hold_expiry' },
    hold.expiresAt,
  );
}

/** Releases the proposal's hold, held or committed, and returns its seats to the slot. */
export function releaseHold(tx: Tx, deps: OrderDeps, proposalId: string) {
  return restoreSeats({ db: tx, now: deps.now }, proposalId);
}

/**
 * A transition to a final status that frees the hold, inside the caller's Order lock; a
 * pay-online Order also frees its money (`afterRelease`).
 */
export async function releaseIn(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  action: 'decline' | 'fail' | 'expire' | 'cancel',
  input: ActionInput,
): Promise<TransitionOutcome> {
  const result = await transition(tx, deps, order, action, input);
  if (result.outcome !== 'applied') return result;
  const attempt =
    result.order.paymentMode === 'online' ? await lockAttempt(tx, input.proposalId) : undefined;
  await releaseHold(tx, deps, input.proposalId);
  if (action === 'cancel' && result.order.availabilityMode === 'live') {
    // The engine's booking is cancelled by a job, outside this transaction.
    await enqueueAdapterCancel(tx, deps.queue, {
      orderId: order.id,
      proposalId: input.proposalId,
    });
  }
  if (!attempt) return result;
  return { outcome: 'applied', order: await afterRelease(tx, deps, result.order, attempt, input) };
}

/**
 * The effects of entering `pending_provider`: the response deadline, counted in the Offer's
 * response hours in the property's zone, is stored on the proposal, and the window timer set.
 */
export async function askProviderIn(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  proposal: OrderProposalRow,
): Promise<void> {
  const [offer] = await tx
    .select({
      windowMinutes: offers.responseWindowMinutes,
      from: offers.responseHoursFrom,
      to: offers.responseHoursTo,
    })
    .from(offers)
    .where(eq(offers.id, order.offerId));
  if (!offer) throw new OrderRuleError('not-found');
  const { zone } = await stayOfOrder(tx, order);
  const due = responseDueAt(deps.now(), offer, zone);
  await tx
    .update(orderProposals)
    .set({ responseDueAt: due })
    .where(eq(orderProposals.id, proposal.id));
  await scheduleTimer(
    tx,
    deps.queue,
    { orderId: order.id, proposalId: proposal.id, operation: 'response_window' },
    due,
  );
}

/** The effects of entering `confirming` or `pending_provider` after the guest's confirmation. */
async function enterAfterGuestConfirm(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  proposal: OrderProposalRow,
  input: GuestConfirmInput,
) {
  if (order.status === 'confirming') {
    await placeHold(tx, deps, order, proposal, input.hold);
  } else if (order.status === 'pending_provider') {
    await askProviderIn(tx, deps, order, proposal);
  }
}

/**
 * Opens the proposal's payment attempt and its Checkout job. The Checkout Session expires with
 * the hold, at the one stored instant. Each proposal has its own attempt, so its Stripe keys carry
 * the proposal's version.
 */
async function openAttemptIn(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  proposal: OrderProposalRow,
  expiresAt: Date,
) {
  if (proposal.priceMinor === null) throw new OrderRuleError('invalid-input');
  const [offer] = await tx
    .select({ title: offers.title })
    .from(offers)
    .where(eq(offers.id, order.offerId));
  // The Provider's account, or the host's for an own service (38).
  const merchant = await merchantOf(tx, order.offerId);
  if (!offer || !merchant?.stripeAccountId) throw new OrderRuleError('payments-not-ready');
  const { language } = await stayOfOrder(tx, order);
  const now = deps.now();
  const [attempt] = await tx
    .insert(paymentAttempts)
    .values({
      orderId: order.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      stripeAccountId: merchant.stripeAccountId,
      amountMinor: proposal.priceMinor,
      currency: proposal.currency,
      applicationFeeMinor: applicationFee(proposal.priceMinor, order.commissionBp),
      productName: offer.title,
      locale: PAYMENT_LOCALES[language],
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!attempt) throw new Error('no payment attempt');
  await enqueuePaymentJob(tx, deps.queue, attempt, 'open');
}

/**
 * Creates an Order from the guest's tap: the Order, its first proposal and the creation event,
 * then the guest's confirmation, in one transaction. Idempotent on `input.id`.
 */
export async function createOrder(
  deps: OrderDeps,
  input: CreateOrderInput,
): Promise<{ order: OrderRow; created: boolean }> {
  const email = input.contact.email.trim();
  if (!isQuantity(input.quantity) || email === '') throw new OrderRuleError('invalid-input');
  return deps.db.transaction(async (tx) => {
    const existing = async () => {
      if (!input.id) return undefined;
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.id));
      if (order && order.spaceId !== input.spaceId) throw new OrderRuleError('invalid-input');
      return order;
    };
    const before = await existing();
    if (before) return { order: before, created: false };

    const stayAndZone = await stayOfSpace(tx, input.spaceId);
    if (!stayAndZone) throw new OrderRuleError('not-found');
    assertWithinStay(input.date, stayAndZone.stay);

    const offer = await lockOfferRow(tx, input.offerId);
    if (!offer) throw new OrderRuleError('not-found');
    if (!offer.active) throw new OrderRuleError('offer-inactive');
    const online = offer.paymentMode === 'online';
    // Pay-online is an allotment or on-request Offer, a Provider's or the host's own (38); live
    // (37) is not yet.
    if (online && offer.availabilityMode === 'live') {
      throw new OrderRuleError('payment-mode-unsupported');
    }
    if (offer.availabilityMode === 'allotment' && !input.slotId) {
      throw new OrderRuleError('invalid-input');
    }
    const slot = input.slotId
      ? await assertSlot(tx, input.slotId, offer.id, input.date, stayAndZone.zone)
      : undefined;
    // A host's own Offer has no Fetivi commission (38).
    const merchant = await merchantOf(tx, offer.id);
    const commissionBp = merchant?.commissionBp ?? 0;
    const stripeAccountId = online ? merchant?.stripeAccountId : null;
    if (online && (!stripeAccountId || merchant?.cardStatus !== 'active')) {
      throw new OrderRuleError('payments-not-ready');
    }
    const priceMinor =
      offer.priceMinor === null
        ? null
        : offer.priceUnit === 'group'
          ? offer.priceMinor
          : offer.priceMinor * input.quantity;
    // Online without a price is only a request-kind on-request Order: it pays after the
    // Provider's Accept with price.
    if (online && !priceMinor && offer.orderKind !== 'request') {
      throw new OrderRuleError('invalid-input');
    }

    const now = deps.now();
    const [inserted] = await tx
      .insert(orders)
      .values({
        id: input.id,
        spaceId: input.spaceId,
        stayId: stayAndZone.stay.id,
        offerId: offer.id,
        availabilityMode: offer.availabilityMode,
        paymentMode: offer.paymentMode,
        date: input.date,
        quantity: input.quantity,
        guestEmail: email,
        guestName: input.contact.name,
        guestPhone: input.contact.phone,
        cancellationPolicy: offer.cancellationPolicy,
        freeCancelHoursBefore: offer.freeCancelHoursBefore,
        refundPercentAfter: offer.refundPercentAfter,
        currency: offer.currency,
        priceUnit: offer.priceUnit,
        commissionBp,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: orders.id })
      .returning();
    if (!inserted) {
      // A concurrent retry with the same id committed first.
      const order = await existing();
      if (!order) throw new OrderRuleError('invalid-input');
      return { order, created: false };
    }

    const [proposal] = await tx
      .insert(orderProposals)
      .values({
        orderId: inserted.id,
        version: 1,
        date: input.date,
        startsAt: slot?.startsAt ?? input.startsAt,
        slotId: slot?.id,
        quantity: input.quantity,
        priceMinor,
        currency: offer.currency,
        proposer: 'offer',
        createdAt: now,
      })
      .returning();
    if (!proposal) throw new Error('no proposal');
    await tx
      .update(orders)
      .set({ currentProposalId: proposal.id })
      .where(eq(orders.id, inserted.id));
    await tx.insert(orderEvents).values({
      orderId: inserted.id,
      proposalId: proposal.id,
      fromStatus: null,
      toStatus: inserted.status,
      fromPaymentStatus: null,
      toPaymentStatus: inserted.paymentStatus,
      trigger: 'guest',
      createdAt: now,
    });

    // The Order is born from the guest's tap, so the tap is also its confirmation.
    const asks = asksProvider(
      offer.availabilityMode,
      { proposer: 'offer', priceMinor },
      offer.paymentMode,
    );
    const to = nextStatus(inserted.status, 'guest_confirm', 'guest', asks);
    if (!to) throw new Error('guest_confirm must apply to a new Order');
    const order = await writeStatus(tx, deps, inserted, to, proposal.id, { trigger: 'guest' });
    await enterAfterGuestConfirm(tx, deps, order, proposal, input);
    if (to === 'confirming' && stripeAccountId && priceMinor && input.hold) {
      await openAttemptIn(tx, deps, order, proposal, input.hold.expiresAt);
    }
    return { order, created: true };
  });
}

/** The guest confirms a later proposal (a new time or price, 36). */
export async function guestConfirm(
  deps: OrderDeps,
  input: ActionInput & GuestConfirmInput,
): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const asks = asksProvider(order.availabilityMode, proposal, order.paymentMode);
    const result = await transition(tx, deps, order, 'guest_confirm', input, asks);
    if (result.outcome !== 'applied') return result;
    await enterAfterGuestConfirm(tx, deps, result.order, proposal, input);
    const online = result.order.paymentMode === 'online';
    if (result.order.status === 'confirming' && online && proposal.priceMinor !== null) {
      // `placeHold` above required the hold.
      if (input.hold) await openAttemptIn(tx, deps, result.order, proposal, input.hold.expiresAt);
    }
    return result;
  });
}

/**
 * The Order is confirmed: the hold is committed, the completion timer scheduled, and the guest's
 * evening-before reminder enqueued on guest-notify (unless that evening has passed). A pay-online
 * Order is confirmed only once authorized, and its capture follows.
 */
export async function confirm(
  deps: OrderDeps,
  input: ActionInput & { providerExternalRef?: string },
): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const online = order.paymentMode === 'online';
    if (
      online &&
      order.paymentStatus !== 'authorized' &&
      nextStatus(order.status, 'confirm', input.trigger, false) !== null
    ) {
      return { outcome: 'rejected', order };
    }
    const result = await transition(tx, deps, order, 'confirm', input);
    if (result.outcome !== 'applied') return result;
    if (online) {
      const attempt = await lockAttempt(tx, proposal.id);
      if (attempt) await enqueuePaymentJob(tx, deps.queue, attempt, 'capture');
    }
    await tx
      .update(inventoryHolds)
      .set({ state: 'committed', resolvedAt: deps.now() })
      .where(and(eq(inventoryHolds.proposalId, proposal.id), eq(inventoryHolds.state, 'held')));
    let confirmed = result.order;
    if (input.providerExternalRef !== undefined) {
      const [updated] = await tx
        .update(orders)
        .set({ providerExternalRef: input.providerExternalRef })
        .where(eq(orders.id, order.id))
        .returning();
      if (updated) confirmed = updated;
    }
    const { zone } = await stayOfOrder(tx, order);
    await scheduleTimer(
      tx,
      deps.queue,
      { orderId: order.id, proposalId: proposal.id, operation: 'completion' },
      endOfCivilDay(proposal.date, zone),
    );
    const remindAt = orderReminderAt(proposal.date, zone);
    if (remindAt > deps.now()) {
      await enqueueGuestNotification(
        tx,
        deps.queue,
        {
          kind: 'order_reminder',
          spaceId: order.spaceId,
          orderId: order.id,
          proposalId: proposal.id,
        },
        remindAt,
      );
    }
    return { outcome: 'applied', order: confirmed };
  });
}

/**
 * A paid-first on-request Order is authorized: it is put to the Provider inside the caller's
 * Order lock (`payments.ts` `authorize`). The Checkout's hold is released, since on request takes
 * no capacity and reconciliation would report a `held` hold on a `pending_provider` Order.
 */
export async function askProviderAfterPayment(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  proposal: OrderProposalRow,
  input: ActionInput,
): Promise<TransitionOutcome> {
  const result = await transition(tx, deps, order, 'ask_provider', input);
  if (result.outcome !== 'applied') return result;
  await releaseHold(tx, deps, proposal.id);
  await askProviderIn(tx, deps, result.order, proposal);
  return result;
}

/** A transition to a final status that frees the hold: decline, fail, expire, cancel. */
function releasing(action: 'decline' | 'fail' | 'expire' | 'cancel') {
  return (deps: OrderDeps, input: ActionInput) =>
    withLockedOrder(deps, input.orderId, input.proposalId, (tx, order) =>
      releaseIn(tx, deps, order, action, input),
    );
}

export const decline = releasing('decline');
export const fail = releasing('fail');
export const cancel = releasing('cancel');

const expireNow = releasing('expire');

/** Expires the Order. A timer acts only when its deadline, re-read here, has passed. */
export async function expire(deps: OrderDeps, input: ActionInput): Promise<TransitionOutcome> {
  if (input.trigger !== 'card_timer' && input.trigger !== 'hold_timer') {
    return expireNow(deps, input);
  }
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const now = deps.now();
    if (input.trigger === 'card_timer') {
      if (!proposal.cardExpiresAt || proposal.cardExpiresAt > now) {
        return { outcome: 'stale', order };
      }
    } else {
      const hold = await currentHold(tx, proposal.id);
      if (hold?.state !== 'held' || hold.expiresAt > now) {
        return { outcome: 'stale', order };
      }
      // The guest paid in time (`authorize` checked the completion against the hold), and the
      // confirm job is queued: it confirms the Order, or a release voids the authorization.
      if (order.status === 'confirming' && order.paymentStatus === 'authorized') {
        return { outcome: 'stale', order };
      }
    }
    return releaseIn(tx, deps, order, 'expire', input);
  });
}

/** The Order's day has passed. The hold stays committed. */
export async function complete(deps: OrderDeps, input: ActionInput): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, (tx, order) =>
    transition(tx, deps, order, 'complete', input),
  );
}

export interface ProposeInput extends ActionInput {
  terms: {
    date: CivilDate;
    startsAt?: Date;
    slotId?: string;
    quantity: number;
    priceMinor?: number;
  };
  proposer: Proposer;
  /** When the guest's card for the new terms stops working. */
  cardExpiresAt: Date;
}

/**
 * New terms from the Provider or the admin. The current proposal is superseded (its hold
 * released, its payment attempt voided or its Checkout expired), Payment status starts again at
 * `none` for the new proposal, and the Order waits for the guest's confirmation of it. The new
 * proposal's attempt is opened when the guest accepts.
 */
export async function propose(deps: OrderDeps, input: ProposeInput): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const to = nextStatus(order.status, 'propose', input.trigger, false);
    if (to === null) return transition(tx, deps, order, 'propose', input);
    const { terms } = input;
    const now = deps.now();
    if (!isQuantity(terms.quantity)) throw new OrderRuleError('invalid-input');
    const price = terms.priceMinor ?? proposal.priceMinor;
    if (
      terms.priceMinor !== undefined &&
      (!Number.isInteger(terms.priceMinor) ||
        terms.priceMinor < 1 ||
        terms.priceMinor > OFFER_LIMITS.priceMinorMax)
    ) {
      throw new OrderRuleError('invalid-input');
    }
    if (order.paymentMode === 'online' && price === null) throw new OrderRuleError('invalid-input');
    if ((terms.startsAt && terms.startsAt <= now) || input.cardExpiresAt <= now) {
      throw new OrderRuleError('invalid-input');
    }
    const { stay, zone } = await stayOfOrder(tx, order);
    assertWithinStay(terms.date, stay);
    const slot = terms.slotId
      ? await assertSlot(tx, terms.slotId, order.offerId, terms.date, zone)
      : undefined;

    // Order, then attempt: lock the superseded attempt before anything else.
    const old = order.paymentMode === 'online' ? await lockAttempt(tx, proposal.id) : undefined;
    await tx
      .update(orderProposals)
      .set({ supersededAt: now })
      .where(eq(orderProposals.id, proposal.id));
    await releaseHold(tx, deps, proposal.id);
    const wasAuthorized = order.paymentStatus === 'authorized';
    if (old && wasAuthorized) await enqueuePaymentJob(tx, deps.queue, old, 'void');
    else if (old && order.paymentStatus === 'none') await expireOpenSession(tx, deps, old);
    const [next] = await tx
      .insert(orderProposals)
      .values({
        orderId: order.id,
        version: proposal.version + 1,
        date: terms.date,
        startsAt: slot?.startsAt ?? terms.startsAt,
        slotId: slot?.id,
        quantity: terms.quantity,
        priceMinor: price,
        currency: proposal.currency,
        proposer: input.proposer,
        cardExpiresAt: input.cardExpiresAt,
        createdAt: now,
      })
      .returning();
    if (!next) throw new Error('no proposal');
    const [moved] = await tx
      .update(orders)
      .set({ currentProposalId: next.id, date: terms.date, quantity: terms.quantity })
      .where(eq(orders.id, order.id))
      .returning();
    if (!moved) throw new OrderRuleError('not-found');
    // Payment status describes the current proposal's attempt, and the new one has none yet.
    const updated = await writeChange(
      tx,
      deps,
      moved,
      { status: to, paymentStatus: 'none' },
      next.id,
      wasAuthorized
        ? { ...input, note: input.note ?? 'new proposal; earlier authorization voided' }
        : input,
    );
    await scheduleTimer(
      tx,
      deps.queue,
      { orderId: order.id, proposalId: next.id, operation: 'card_expiry' },
      input.cardExpiresAt,
    );
    return { outcome: 'applied', order: updated };
  });
}

/**
 * The response window timer: alerts the admin once if the Provider has not answered the current
 * proposal. Changes no status and writes no OrderEvent. Called by `runOrderTimer`.
 */
export async function responseWindowMissed(
  deps: OrderDeps,
  input: { orderId: string; proposalId: string },
): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    if (order.status !== 'pending_provider') return { outcome: 'stale', order };
    // The timer re-reads the stored deadline: it acts only once it has passed.
    if (!proposal.responseDueAt || proposal.responseDueAt > deps.now()) {
      return { outcome: 'stale', order };
    }
    await enqueueNotification(tx, deps.queue, {
      orderId: order.id,
      proposalId: input.proposalId,
      kind: 'admin_window_missed',
    });
    return { outcome: 'applied', order };
  });
}

/** The order-timer job: hands a due timer back to the machine. */
export async function runOrderTimer(
  deps: OrderDeps,
  { orderId, proposalId, operation }: OrderTimerJobData,
): Promise<TransitionOutcome> {
  switch (operation) {
    case 'card_expiry':
      return expire(deps, { orderId, proposalId, trigger: 'card_timer' });
    case 'hold_expiry':
      return expire(deps, { orderId, proposalId, trigger: 'hold_timer' });
    case 'completion':
      return complete(deps, { orderId, proposalId, trigger: 'completion_timer' });
    case 'response_window':
      return responseWindowMissed(deps, { orderId, proposalId });
  }
}

/** An Order with its current proposal. */
export async function getOrder(
  db: Executor,
  id: string,
): Promise<{ order: OrderRow; proposal: OrderProposalRow } | undefined> {
  const [row] = await db
    .select({ order: orders, proposal: orderProposals })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .where(eq(orders.id, id));
  return row;
}

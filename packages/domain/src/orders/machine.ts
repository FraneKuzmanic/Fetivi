import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';
import { allotmentSlots, providers } from '../db/schema/offers';
import {
  inventoryHolds,
  type OrderProposalRow,
  type OrderRow,
  orderEvents,
  orderProposals,
  orders,
} from '../db/schema/orders';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { JobQueue } from '../jobs/queue';
import { lockOfferRow } from '../offers/translation';
import { allotmentAdapter, restoreSeats } from '../services/adapters/allotment';
import { AdapterError } from '../services/adapters/interface';
import { type CivilDate, endOfCivilDay, toLocalDateTime } from '../time';
import { enqueueNotification, type OrderTimerJobData, scheduleTimer } from './timers';
import { actionTarget, nextStatus, type OrderAction, requiredNotifications } from './transitions';
import type { OrderStatus, OrderTrigger, Proposer } from './vocabulary';

// The Order state machine: the only writer of `orders.status` and `orders.payment_status`.
// Every transition runs in one transaction that locks the Order row, writes the status and its
// OrderEvent, applies the hold and seat effects, and inserts the next jobs through the same
// transaction. Passing a transaction as `db` makes this a savepoint inside the caller's.
// Allotment seats are taken and returned through the allotment adapter, inside the machine's
// transaction. Lock order everywhere: Order row, then slot row (createOrder: Offer, then slot).
// Pay-direct only: Payment status stays `none` (ticket 33 adds payments here).

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

/** What the guest's confirmation needs: a hold for live and allotment, a window for on request. */
interface GuestConfirmInput {
  hold?: HoldInput;
  /** When the Provider's response window ends; computed by the caller (36). */
  responseDeadline?: Date;
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
    .select({ stay: stays, zone: properties.timezone })
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

/** Writes the status, its OrderEvent and the notifications the change requires. */
async function writeStatus(
  tx: Tx,
  deps: OrderDeps,
  order: OrderRow,
  to: OrderStatus,
  proposalId: string,
  meta: { trigger: OrderTrigger; actorId?: string; note?: string },
): Promise<OrderRow> {
  const now = deps.now();
  const [updated] = await tx
    .update(orders)
    .set({ status: to, updatedAt: now })
    .where(eq(orders.id, order.id))
    .returning();
  if (!updated) throw new OrderRuleError('not-found');
  await tx.insert(orderEvents).values({
    orderId: order.id,
    proposalId,
    fromStatus: order.status,
    toStatus: to,
    fromPaymentStatus: order.paymentStatus,
    toPaymentStatus: order.paymentStatus,
    trigger: meta.trigger,
    actorId: meta.actorId,
    note: meta.note,
    createdAt: now,
  });
  for (const kind of requiredNotifications(order.status, to, meta.trigger)) {
    await enqueueNotification(tx, deps.queue, { orderId: order.id, proposalId, kind });
  }
  return updated;
}

/**
 * Locks the Order and its current proposal, then runs `body`. A proposal that is not current
 * is `stale` before `body` sees it.
 */
async function withLockedOrder(
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
): Promise<TransitionOutcome> {
  const to = nextStatus(order.status, action, input.trigger, order.availabilityMode);
  if (to === null) {
    const target = actionTarget(action, input.trigger, order.availabilityMode);
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
function releaseHold(tx: Tx, deps: OrderDeps, proposalId: string) {
  return restoreSeats({ db: tx, now: deps.now }, proposalId);
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
  } else if (order.status === 'pending_provider' && input.responseDeadline) {
    await scheduleTimer(
      tx,
      deps.queue,
      { orderId: order.id, proposalId: proposal.id, operation: 'response_window' },
      input.responseDeadline,
    );
  }
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
    if (offer.paymentMode === 'online') throw new OrderRuleError('payment-mode-unsupported');
    if (offer.availabilityMode === 'allotment' && !input.slotId) {
      throw new OrderRuleError('invalid-input');
    }
    const slot = input.slotId
      ? await assertSlot(tx, input.slotId, offer.id, input.date, stayAndZone.zone)
      : undefined;
    let commissionBp = 0;
    if (offer.providerId) {
      const [provider] = await tx
        .select({ commissionBp: providers.commissionBp })
        .from(providers)
        .where(eq(providers.id, offer.providerId));
      commissionBp = provider?.commissionBp ?? 0;
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

    const priceMinor =
      offer.priceMinor === null
        ? null
        : offer.priceUnit === 'group'
          ? offer.priceMinor
          : offer.priceMinor * input.quantity;
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
    const to = nextStatus(inserted.status, 'guest_confirm', 'guest', offer.availabilityMode);
    if (!to) throw new Error('guest_confirm must apply to a new Order');
    const order = await writeStatus(tx, deps, inserted, to, proposal.id, { trigger: 'guest' });
    await enterAfterGuestConfirm(tx, deps, order, proposal, input);
    return { order, created: true };
  });
}

/** The guest confirms a later proposal (a new time or price, 36). */
export async function guestConfirm(
  deps: OrderDeps,
  input: ActionInput & GuestConfirmInput,
): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const result = await transition(tx, deps, order, 'guest_confirm', input);
    if (result.outcome === 'applied') {
      await enterAfterGuestConfirm(tx, deps, result.order, proposal, input);
    }
    return result;
  });
}

/** The Order is confirmed: the hold is committed and the completion timer scheduled. */
export async function confirm(
  deps: OrderDeps,
  input: ActionInput & { providerExternalRef?: string },
): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const result = await transition(tx, deps, order, 'confirm', input);
    if (result.outcome !== 'applied') return result;
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
    return { outcome: 'applied', order: confirmed };
  });
}

/** A transition to a final status that frees the hold: decline, fail, expire, cancel. */
function releasing(action: 'decline' | 'fail' | 'expire' | 'cancel') {
  return (deps: OrderDeps, input: ActionInput) =>
    withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
      const result = await transition(tx, deps, order, action, input);
      if (result.outcome === 'applied') await releaseHold(tx, deps, proposal.id);
      return result;
    });
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
    }
    const result = await transition(tx, deps, order, 'expire', input);
    if (result.outcome === 'applied') await releaseHold(tx, deps, proposal.id);
    return result;
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
 * released), and the Order waits for the guest's confirmation of the new one.
 */
export async function propose(deps: OrderDeps, input: ProposeInput): Promise<TransitionOutcome> {
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order, proposal) => {
    const to = nextStatus(order.status, 'propose', input.trigger, order.availabilityMode);
    if (to === null) return transition(tx, deps, order, 'propose', input);
    const { terms } = input;
    if (!isQuantity(terms.quantity)) throw new OrderRuleError('invalid-input');
    const { stay, zone } = await stayOfOrder(tx, order);
    assertWithinStay(terms.date, stay);
    const slot = terms.slotId
      ? await assertSlot(tx, terms.slotId, order.offerId, terms.date, zone)
      : undefined;

    const now = deps.now();
    await tx
      .update(orderProposals)
      .set({ supersededAt: now })
      .where(eq(orderProposals.id, proposal.id));
    await releaseHold(tx, deps, proposal.id);
    const [next] = await tx
      .insert(orderProposals)
      .values({
        orderId: order.id,
        version: proposal.version + 1,
        date: terms.date,
        startsAt: slot?.startsAt ?? terms.startsAt,
        slotId: slot?.id,
        quantity: terms.quantity,
        priceMinor: terms.priceMinor ?? proposal.priceMinor,
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
    const updated = await writeStatus(tx, deps, moved, to, next.id, input);
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
  return withLockedOrder(deps, input.orderId, input.proposalId, async (tx, order) => {
    if (order.status !== 'pending_provider') return { outcome: 'stale', order };
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

import {
  accounts,
  adminCancel,
  adminRefund,
  type Db,
  destinations,
  isFinalOrderStatus,
  type JobQueue,
  OFFER_LIMITS,
  OrderRuleError,
  offers,
  orderEvents,
  orderProposals,
  orderStart,
  orders,
  paymentAttempts,
  properties,
  providerAccept,
  providerDecline,
  providerPropose,
  providers,
  refundFor,
  stays,
  type TransitionOutcome,
  units,
} from '@fetivi/domain';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';
import { HHMM } from '../properties/schemas';

export interface AdminOrderDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const Note = z.string().trim().max(500).optional();
const CancelBody = z.object({ refundMinor: z.number().int().min(0).optional(), note: Note });
const RefundBody = z.object({ refundMinor: z.number().int().min(1), note: Note });
// A phoned answer (36): the note is the record of what the Provider said, so it is required.
const AnswerBody = z.object({ proposalId: z.uuid(), note: z.string().trim().min(1).max(500) });
const ProposeBody = AnswerBody.extend({
  date: z.iso.date(),
  time: z.string().regex(HHMM).optional(),
  priceMinor: z.number().int().min(1).max(OFFER_LIMITS.priceMinorMax).optional(),
});

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** One Order as the admin page shows it, with what the admin may still do. */
async function orderView(db: Db, id: string, now: Date) {
  const [row] = await db
    .select({
      order: orders,
      proposal: orderProposals,
      attempt: paymentAttempts,
      offerTitle: offers.title,
      orderKind: offers.orderKind,
      providerName: providers.name,
      zone: properties.timezone,
      destinationZone: destinations.timezone,
      stayFrom: stays.checkIn,
      stayTo: stays.checkout,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .leftJoin(paymentAttempts, eq(paymentAttempts.proposalId, orders.currentProposalId))
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .leftJoin(destinations, eq(destinations.id, offers.destinationId))
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(orders.id, id));
  if (!row) return null;
  const { order, proposal, attempt } = row;
  const events = await db
    .select({ event: orderEvents, actorEmail: accounts.email })
    .from(orderEvents)
    .leftJoin(accounts, eq(accounts.id, orderEvents.actorId))
    .where(eq(orderEvents.orderId, id))
    .orderBy(asc(orderEvents.id));
  const captured = order.paymentStatus === 'captured' && attempt !== null;
  const policyRefundMinor =
    captured && attempt
      ? refundFor({
          amountMinor: attempt.amountMinor,
          startsAt: orderStart(proposal, row.zone),
          freeCancelHoursBefore: order.freeCancelHoursBefore,
          refundPercentAfter: order.refundPercentAfter,
          now,
        }).amountMinor
      : null;
  const released = order.status === 'cancelled' || order.status === 'completed';
  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMode: order.paymentMode,
    availabilityMode: order.availabilityMode,
    offerTitle: row.offerTitle,
    providerName: row.providerName,
    date: proposal.date,
    startsAt: iso(proposal.startsAt),
    quantity: proposal.quantity,
    priceMinor: proposal.priceMinor,
    currency: proposal.currency,
    cancellationPolicy: order.cancellationPolicy,
    freeCancelHoursBefore: order.freeCancelHoursBefore,
    refundPercentAfter: order.refundPercentAfter,
    /** What the snapshotted rules would refund if the Order were cancelled now. */
    policyRefundMinor,
    /** Paid online and captured, so an override amount applies to a cancel. */
    paidAmountMinor: captured ? (attempt?.amountMinor ?? null) : null,
    refundAmountMinor: attempt?.refundAmountMinor ?? null,
    proposalId: proposal.id,
    proposer: proposal.proposer,
    version: proposal.version,
    orderKind: row.orderKind,
    /** When the Provider's on-request answer is due (36). */
    responseDueAt: iso(proposal.responseDueAt),
    windowMissed:
      order.status === 'pending_provider' &&
      proposal.responseDueAt !== null &&
      proposal.responseDueAt <= now,
    /** The admin may record the Provider's phoned answer. */
    canAnswer: order.status === 'pending_provider',
    stayFrom: row.stayFrom,
    stayTo: row.stayTo,
    /** The zone a new time is entered in, as the Provider page shows it. */
    zone: row.destinationZone ?? row.zone,
    canCancel: !isFinalOrderStatus(order.status) && order.status !== 'confirming',
    // adminRefund's rule: one refund per attempt, only once the Order is released.
    canRefund:
      released &&
      captured &&
      (attempt?.refundAmountMinor === null || attempt?.refundAmountMinor === 0),
    events: events.map(({ event, actorEmail }) => ({
      id: event.id,
      at: event.createdAt.toISOString(),
      from: event.fromStatus,
      to: event.toStatus,
      fromPayment: event.fromPaymentStatus,
      toPayment: event.toPaymentStatus,
      trigger: event.trigger,
      note: event.note,
      actorEmail,
    })),
  };
}

/** The machine's refusals as HTTP errors. */
async function acting(
  run: () => Promise<TransitionOutcome>,
  conflict: 'not-cancellable' | 'not-refundable' | 'not-answerable',
) {
  let result: TransitionOutcome;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof OrderRuleError) {
      if (error.code === 'not-found') throw new HttpError(404, 'not-found');
      if (error.code === 'invalid-input' || error.code === 'date-outside-stay') {
        throw new HttpError(400, 'invalid-input');
      }
    }
    throw error;
  }
  if (result.outcome === 'rejected' || result.outcome === 'stale') {
    throw new HttpError(409, conflict);
  }
}

/** A phoned answer is recorded as the admin, with the note as what the Provider said. */
const answerMeta = (request: FastifyRequest, note: string) => ({
  trigger: 'admin' as const,
  actorId: principalOf(request).account.id,
  note,
});

/**
 * The admin's single-Order page (35): the Order, its payment, policy and events, a cancel with
 * an optional refund override and a refund of a released Order whose money is still captured.
 * Every action is an OrderEvent with trigger `admin`, the admin's id and a note. On a
 * `pending_provider` Order the admin records the Provider's phoned answer (36): accept, decline
 * or new terms, bound to the proposal the page showed.
 */
export async function adminOrderRoutes(app: FastifyInstance, deps: AdminOrderDeps): Promise<void> {
  const { db } = deps;
  const admin = { config: { access: 'admin' as const } };
  const machine = () => ({ db, queue: deps.queue, now: deps.now });

  const view = async (id: string) => {
    const found = await orderView(db, id, deps.now());
    if (!found) throw new HttpError(404, 'not-found');
    return found;
  };

  app.get('/api/admin/orders/:id', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    return view(id);
  });

  app.post('/api/admin/orders/:id/cancel', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = CancelBody.parse(request.body ?? {});
    const actorId = principalOf(request).account.id;
    await acting(
      () =>
        adminCancel(machine(), {
          orderId: id,
          actorId,
          refundMinor: body.refundMinor,
          note: body.note || undefined,
        }),
      'not-cancellable',
    );
    return view(id);
  });

  app.post('/api/admin/orders/:id/refund', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = RefundBody.parse(request.body ?? {});
    const actorId = principalOf(request).account.id;
    await acting(
      () =>
        adminRefund(machine(), {
          orderId: id,
          actorId,
          refundMinor: body.refundMinor,
          note: body.note || undefined,
        }),
      'not-refundable',
    );
    return view(id);
  });

  app.post('/api/admin/orders/:id/accept', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = AnswerBody.parse(request.body ?? {});
    const meta = answerMeta(request, body.note);
    await acting(
      () => providerAccept(machine(), { orderId: id, proposalId: body.proposalId }, meta),
      'not-answerable',
    );
    return view(id);
  });

  app.post('/api/admin/orders/:id/decline', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = AnswerBody.parse(request.body ?? {});
    const meta = answerMeta(request, body.note);
    await acting(
      () => providerDecline(machine(), { orderId: id, proposalId: body.proposalId }, meta),
      'not-answerable',
    );
    return view(id);
  });

  app.post('/api/admin/orders/:id/propose', admin, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = ProposeBody.parse(request.body ?? {});
    const meta = answerMeta(request, body.note);
    const terms = { date: body.date, time: body.time, priceMinor: body.priceMinor };
    await acting(
      () => providerPropose(machine(), { orderId: id, proposalId: body.proposalId }, terms, meta),
      'not-answerable',
    );
    return view(id);
  });
}

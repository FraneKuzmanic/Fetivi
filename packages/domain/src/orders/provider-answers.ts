import { eq } from 'drizzle-orm';
import { destinations } from '../db/schema/catalog';
import { offers } from '../db/schema/offers';
import { type OrderProposalRow, type OrderRow, orders } from '../db/schema/orders';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import type { OrderKind } from '../offers/vocabulary';
import { PROPOSAL_CARD_HOURS } from '../services/pending/vocabulary';
import { type CivilDate, fromLocalDateTime, InvalidTimeInputError, toLocalDateTime } from '../time';
import {
  confirm,
  decline,
  getOrder,
  type OrderDeps,
  OrderRuleError,
  propose,
  type TransitionOutcome,
} from './machine';
import { orderStart } from './refunds';
import type { Proposer } from './vocabulary';

// The Provider's answers to an on-request Order (36): Accept, Decline and new terms. The per-order
// link calls them with `provider_link`; the admin records a phoned answer with `admin`, the actor
// and a note. Each answer is bound to the proposal the page showed.

export type AnswerTrigger = 'provider_link' | 'admin';

export interface AnswerMeta {
  trigger: AnswerTrigger;
  actorId?: string;
  note?: string;
}

export interface AnswerRef {
  orderId: string;
  proposalId: string;
}

/** New terms: a date in the stay, an optional 'HH:mm' start in the Offer's zone, a total price. */
export interface ProposedTerms {
  date: CivilDate;
  time?: string;
  priceMinor?: number;
}

const HOUR_MS = 3_600_000;

/** When the guest's card for new terms stops working: PROPOSAL_CARD_HOURS from now, never past the new start. */
export function proposalCardExpiry(now: Date, start: Date): Date {
  return new Date(Math.min(now.getTime() + PROPOSAL_CARD_HOURS * HOUR_MS, start.getTime()));
}

/**
 * The Order the answer is for, with what the answer needs, or the outcome when it has no Provider
 * answer: `stale` for an older proposal, `rejected` unless it is on request.
 */
async function answerable(
  deps: OrderDeps,
  ref: AnswerRef,
): Promise<
  | { done: TransitionOutcome }
  | { order: OrderRow; proposal: OrderProposalRow; orderKind: OrderKind; zone: string }
> {
  const found = await getOrder(deps.db, ref.orderId);
  if (!found) throw new OrderRuleError('not-found');
  const { order, proposal } = found;
  if (order.currentProposalId !== ref.proposalId) {
    return { done: { outcome: 'stale', order } };
  }
  // Other modes get their own Provider actions (allotment's Got it / Can't fulfil, 37).
  if (order.availabilityMode !== 'on_request') {
    return { done: { outcome: 'rejected', order } };
  }
  const [offer] = await deps.db
    .select({
      orderKind: offers.orderKind,
      zone: destinations.timezone,
      propertyZone: properties.timezone,
    })
    .from(orders)
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(destinations, eq(destinations.id, offers.destinationId))
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(orders.id, order.id));
  if (!offer) throw new OrderRuleError('not-found');
  // The zone the Provider page shows times in.
  return { order, proposal, orderKind: offer.orderKind, zone: offer.zone ?? offer.propertyZone };
}

/** Accept: the Order is confirmed. A request-kind Offer needs a price, so it uses new terms. */
export async function providerAccept(
  deps: OrderDeps,
  ref: AnswerRef,
  meta: AnswerMeta,
): Promise<TransitionOutcome> {
  const found = await answerable(deps, ref);
  if ('done' in found) return found.done;
  if (found.orderKind === 'request') return { outcome: 'rejected', order: found.order };
  return confirm(deps, { ...ref, ...meta });
}

/** Decline: the Order is declined, the hold released and any authorization voided. */
export async function providerDecline(
  deps: OrderDeps,
  ref: AnswerRef,
  meta: AnswerMeta,
): Promise<TransitionOutcome> {
  const found = await answerable(deps, ref);
  if ('done' in found) return found.done;
  return decline(deps, { ...ref, ...meta });
}

/**
 * Suggest another time or Accept with price: a new proposal the guest confirms or declines.
 * A request-kind Order's new terms must carry the price it never had.
 */
export async function providerPropose(
  deps: OrderDeps,
  ref: AnswerRef,
  terms: ProposedTerms,
  meta: AnswerMeta,
): Promise<TransitionOutcome> {
  const found = await answerable(deps, ref);
  if ('done' in found) return found.done;
  const { proposal, zone } = found;
  if (proposal.priceMinor === null && terms.priceMinor === undefined) {
    throw new OrderRuleError('invalid-input');
  }
  let startsAt: Date | undefined;
  if (terms.time !== undefined) {
    try {
      startsAt = fromLocalDateTime(`${terms.date}T${terms.time}`, zone);
    } catch (error) {
      if (error instanceof InvalidTimeInputError) throw new OrderRuleError('invalid-input');
      throw error;
    }
  }
  const sameTime =
    terms.date === proposal.date &&
    (proposal.startsAt ? toLocalDateTime(proposal.startsAt, zone).slice(11) : undefined) ===
      terms.time;
  const proposer: Proposer =
    meta.trigger === 'admin'
      ? 'admin'
      : terms.priceMinor !== undefined && sameTime
        ? 'provider_price'
        : 'provider_time';
  const start = startsAt ?? orderStart({ date: terms.date, startsAt: null }, zone);
  return propose(deps, {
    ...ref,
    ...meta,
    proposer,
    terms: {
      date: terms.date,
      startsAt,
      quantity: proposal.quantity,
      priceMinor: terms.priceMinor,
    },
    cardExpiresAt: proposalCardExpiry(deps.now(), start),
  });
}

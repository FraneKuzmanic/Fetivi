import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client';
import { orderProposals, orders } from '../../db/schema/orders';
import { pendingActions } from '../../db/schema/pending-actions';
import { properties, units } from '../../db/schema/properties';
import { stays } from '../../db/schema/stays';
import { PAYMENT_MODES } from '../../offers/vocabulary';
import { cancel, guestConfirm, type OrderDeps } from '../../orders/machine';
import { cancellationTermsAt, cancellationTermsSchema, orderStart } from '../../orders/refunds';
import { NEW_TERMS_PROPOSERS } from '../../orders/vocabulary';
import { CHECKOUT_HOLD_MINUTES } from '../../payments/vocabulary';
import { GUEST_LANGUAGES, type GuestLanguage } from '../../property/vocabulary';
import { toLocalDateTime } from '../../time';
import { confirmHeldOrder } from '../adapters';
import { getSpaceOrder, type OrderSummary } from './create-order';
import { insertPending, lockPending, markPending } from './store';
import { ORDER_HOLD_MINUTES, PENDING_TTL_SECONDS, type PendingState } from './vocabulary';

// The `respond_to_order_update` halves (36): the guest accepts or declines terms the Provider or
// the admin proposed. The card is bound to the proposal it showed; a newer proposal, or one whose
// card window passed, makes the tap a refusal. Lock order: pending row, then the machine's
// (Order, attempt, slot).

/** The stored respond draft: everything the card shows. */
export const respondOrderPayload = z.object({
  orderId: z.uuid(),
  /** The proposal the card was shown for; a newer one makes the tap a refusal. */
  proposalId: z.uuid(),
  offerTitle: z.string(),
  language: z.enum(GUEST_LANGUAGES),
  proposer: z.enum(NEW_TERMS_PROPOSERS),
  date: z.string(),
  /** 'YYYY-MM-DDTHH:mm' in the property's zone. */
  startsAtLocal: z.string().nullable(),
  quantity: z.number().int(),
  /** The total in cents. */
  priceMinor: z.number().int().nullable(),
  currency: z.string(),
  /** The superseded terms, so the card can show what changed. */
  previous: z.object({
    date: z.string(),
    startsAtLocal: z.string().nullable(),
    priceMinor: z.number().int().nullable(),
  }),
  paymentMode: z.enum(PAYMENT_MODES),
  cancellationPolicy: z.string(),
  /** ISO instant the card stops working. */
  respondBy: z.string(),
  /** `respondBy` as 'YYYY-MM-DDTHH:mm' in the property's zone. */
  respondByLocal: z.string(),
  /** The terms for the new start; null on drafts stored before the terms existed. */
  cancellation: cancellationTermsSchema.nullable().default(null),
});
export type RespondOrderDraft = z.infer<typeof respondOrderPayload>;

export const RESPOND_ANSWERS = ['accept', 'decline'] as const;
export type RespondAnswer = (typeof RESPOND_ANSWERS)[number];

/** The stored record: the draft, plus the guest's answer once given (a replay returns it). */
const respondOrderRecord = respondOrderPayload.extend({
  answer: z.enum(RESPOND_ANSWERS).optional(),
});

/** Why a respond is refused; `not-found` covers another space's Order. */
export type RespondRuleCode =
  | 'not-found'
  | 'no-update'
  | 'stale'
  | 'card-expired'
  | 'expired'
  | 'released';

export class RespondRuleError extends Error {
  override name = 'RespondRuleError';
  constructor(readonly code: RespondRuleCode) {
    super(code);
  }
}

async function loadRespond(db: Executor, spaceId: string, orderId: string) {
  const [row] = await db
    .select({ order: orders, proposal: orderProposals, zone: properties.timezone })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(orders.id, orderId), eq(orders.spaceId, spaceId)));
  return row;
}

/** Only an Order waiting for the guest's answer to a later proposal has one to give. */
function awaitsGuest(order: { status: string }, proposal: { version: number }): boolean {
  return order.status === 'awaiting_confirmation' && proposal.version > 1;
}

/**
 * The first half: checks the Order waits for the guest's answer to new terms and stores a pending
 * record bound to the space, valid until the card window ends (at most PENDING_TTL_SECONDS).
 * Works after checkout too: an unresolved Order still needs its answer.
 */
export async function prepareRespond(
  deps: { db: Executor; now: () => Date },
  ctx: { spaceId: string; language: GuestLanguage },
  input: { orderId: string },
): Promise<{ pendingId: string; draft: RespondOrderDraft }> {
  const now = deps.now();
  const row = await loadRespond(deps.db, ctx.spaceId, input.orderId);
  const summary =
    row && (await getSpaceOrder(deps.db, ctx.spaceId, ctx.language, row.order.id, now));
  if (!row || !summary) throw new RespondRuleError('not-found');
  const { order, proposal, zone } = row;
  if (order.status === 'expired' && proposal.version > 1) {
    throw new RespondRuleError('card-expired');
  }
  if (!awaitsGuest(order, proposal) || proposal.proposer === 'offer') {
    throw new RespondRuleError('no-update');
  }
  if (!proposal.cardExpiresAt || proposal.cardExpiresAt <= now) {
    throw new RespondRuleError('card-expired');
  }
  const [previous] = await deps.db
    .select()
    .from(orderProposals)
    .where(
      and(eq(orderProposals.orderId, order.id), eq(orderProposals.version, proposal.version - 1)),
    );
  if (!previous) throw new RespondRuleError('not-found');
  const draft: RespondOrderDraft = {
    orderId: order.id,
    proposalId: proposal.id,
    offerTitle: summary.offerTitle,
    language: ctx.language,
    proposer: proposal.proposer,
    date: proposal.date,
    startsAtLocal: summary.startsAtLocal,
    quantity: proposal.quantity,
    priceMinor: proposal.priceMinor,
    currency: proposal.currency,
    previous: {
      date: previous.date,
      startsAtLocal: previous.startsAt ? toLocalDateTime(previous.startsAt, zone) : null,
      priceMinor: previous.priceMinor,
    },
    paymentMode: order.paymentMode,
    cancellationPolicy: order.cancellationPolicy,
    respondBy: proposal.cardExpiresAt.toISOString(),
    respondByLocal: toLocalDateTime(proposal.cardExpiresAt, zone),
    // The cutoff follows the new start. Accepting confirms the Order, so the card shows the
    // terms after acceptance, never "free until accepted".
    cancellation:
      summary.cancellation &&
      cancellationTermsAt(summary.cancellation, orderStart(proposal, zone), zone, now),
  };
  const ttl = Math.min(
    now.getTime() + PENDING_TTL_SECONDS * 1000,
    proposal.cardExpiresAt.getTime(),
  );
  // The Order id stays in the payload: `order_id` belongs to create_order records.
  const pending = await insertPending(deps.db, {
    kind: 'respond_to_order_update',
    spaceId: ctx.spaceId,
    stayId: order.stayId,
    payload: draft,
    expiresAt: new Date(ttl),
    now,
  });
  return { pendingId: pending.id, draft };
}

/** A pending `respond_to_order_update` record of this space with its draft; null when it is not one. */
export async function getPendingRespond(
  db: Executor,
  pendingId: string,
  spaceId: string,
): Promise<{ state: PendingState; expiresAt: Date; draft: RespondOrderDraft } | null> {
  const [row] = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.spaceId, spaceId)));
  if (row?.kind !== 'respond_to_order_update') return null;
  return {
    state: row.state,
    expiresAt: row.expiresAt,
    draft: respondOrderPayload.parse(row.payload),
  };
}

export interface RespondCompletion {
  outcome: 'accepted' | 'declined';
  order: OrderSummary;
}

type Step =
  | { kind: 'done'; draft: RespondOrderDraft; answer: RespondAnswer }
  | { kind: 'refused'; code: RespondRuleCode };

/**
 * The second half, on the guest's tap. In one transaction: the pending record is locked, the
 * Order locked and re-read, and the record consumed together with the machine's guest
 * confirmation or cancel (a savepoint). Accepting leads to `confirming`: a pay-direct Order is
 * confirmed right after through the adapter, a pay-online one opens a new Checkout. A repeat
 * finds the record consumed and returns the same answer.
 */
export async function completeRespond(
  deps: OrderDeps,
  input: { pendingId: string; spaceId: string; answer: RespondAnswer },
): Promise<RespondCompletion> {
  // Refusals are returned from the transaction, not thrown, so a release is not rolled back.
  const step = await deps.db.transaction(async (tx): Promise<Step> => {
    const row = await lockPending(tx, input.pendingId);
    if (!row || row.spaceId !== input.spaceId || row.kind !== 'respond_to_order_update') {
      return { kind: 'refused', code: 'not-found' };
    }
    const { answer: stored, ...draft } = respondOrderRecord.parse(row.payload);
    if (row.state === 'consumed') {
      return { kind: 'done', draft, answer: stored ?? input.answer };
    }
    if (row.state === 'released') return { kind: 'refused', code: 'released' };
    const now = deps.now();
    const refuse = async (code: RespondRuleCode): Promise<Step> => {
      await markPending(tx, row.id, 'released', now);
      return { kind: 'refused', code };
    };
    // The record never outlives the card, so a passed card window reads as such.
    if (row.expiresAt <= now) {
      return refuse(new Date(draft.respondBy) <= now ? 'card-expired' : 'expired');
    }

    // The Order row lock first, so the status read here is what the machine sees.
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, draft.orderId))
      .for('update');
    const current = await loadRespond(tx, input.spaceId, draft.orderId);
    if (!current) return refuse('not-found');
    if (current.proposal.id !== draft.proposalId) return refuse('stale');
    const { order, proposal } = current;
    if (order.status === 'expired') return refuse('card-expired');
    if (!awaitsGuest(order, proposal)) return refuse('stale');
    if (!proposal.cardExpiresAt || proposal.cardExpiresAt <= now) return refuse('card-expired');

    const machine = { db: tx, queue: deps.queue, now: deps.now };
    const ref = { orderId: draft.orderId, proposalId: draft.proposalId, trigger: 'guest' as const };
    const minutes = order.paymentMode === 'online' ? CHECKOUT_HOLD_MINUTES : ORDER_HOLD_MINUTES;
    const result =
      input.answer === 'accept'
        ? await guestConfirm(machine, {
            ...ref,
            hold: { expiresAt: new Date(now.getTime() + minutes * 60_000) },
          })
        : await cancel(machine, { ...ref, note: 'guest declined the new proposal' });
    if (result.outcome !== 'applied') return refuse('stale');
    await tx
      .update(pendingActions)
      .set({ payload: { ...draft, answer: input.answer } })
      .where(eq(pendingActions.id, row.id));
    await markPending(tx, row.id, 'consumed', now);
    return { kind: 'done', draft, answer: input.answer };
  });
  if (step.kind === 'refused') throw new RespondRuleError(step.code);

  // The adapter's commit runs outside the transaction. A replay finishes a commit an earlier call
  // lost; confirmHeldOrder is idempotent. A pay-online Order is confirmed by its payment job.
  const { draft } = step;
  if (step.answer === 'accept' && draft.paymentMode !== 'online') {
    const [order] = await deps.db.select().from(orders).where(eq(orders.id, draft.orderId));
    if (order?.status === 'confirming' && order.currentProposalId === draft.proposalId) {
      await confirmHeldOrder(deps, { orderId: draft.orderId, proposalId: draft.proposalId });
    }
  }
  const order = await getSpaceOrder(
    deps.db,
    input.spaceId,
    draft.language,
    draft.orderId,
    deps.now(),
  );
  if (!order) throw new RespondRuleError('not-found');
  return { outcome: step.answer === 'accept' ? 'accepted' : 'declined', order };
}

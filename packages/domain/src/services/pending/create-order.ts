import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Executor } from '../../db/client';
import { offers, offerTranslations } from '../../db/schema/offers';
import { orderProposals, orders } from '../../db/schema/orders';
import { pendingActions } from '../../db/schema/pending-actions';
import { properties, units } from '../../db/schema/properties';
import { spaces } from '../../db/schema/spaces';
import { stays } from '../../db/schema/stays';
import { type GuestOffer, type GuestOfferScope, getGuestOffer } from '../../offers/guest';
import type { PaymentMode } from '../../offers/vocabulary';
import { createOrder, getOrder, type OrderDeps, OrderRuleError } from '../../orders/machine';
import type { OrderStatus, PaymentStatus } from '../../orders/vocabulary';
import type { GuestLanguage } from '../../property/vocabulary';
import { toLocalDateTime } from '../../time';
import { AdapterError, adapterFor, confirmHeldOrder } from '../adapters';
import {
  type CreateOrderDraft,
  insertPending,
  lockPending,
  markPending,
  parsePayload,
} from './store';
import { ORDER_HOLD_MINUTES, PENDING_TTL_SECONDS, type PendingState } from './vocabulary';

// The `create_order` halves of the approved-action binding (architecture §4.3). The first half
// stores a pending record and nothing else; the guest's tap completes exactly that record, once.
// Model-sent parameters never reach `completeOrder`: it reads the stored draft and the guest's
// contact answers only. Lock order: pending row, then the machine's (Offer, then slot).

export type ServiceRuleCode =
  | 'offer-not-visible'
  | 'date-outside-stay'
  | 'date-past'
  | 'not-bookable-in-chat'
  | 'no-availability'
  | 'choose-start'
  | 'start-passed'
  | 'invalid-input'
  | 'expired'
  | 'released'
  | 'not-found';

export class ServiceRuleError extends Error {
  override name = 'ServiceRuleError';
  constructor(readonly code: ServiceRuleCode) {
    super(code);
  }
}

/** Who is asking: the space and the Offers its token may see. */
export interface ServiceContext {
  spaceId: string;
  offerScope: GuestOfferScope;
}

export interface AvailabilityStart {
  slotId: string | null;
  /** ISO instant; null when the Offer has no start time. */
  startsAt: string | null;
  /** 'YYYY-MM-DDTHH:mm' in the property's zone. */
  startsAtLocal: string | null;
  remaining: number | null;
}

export interface Availability {
  offerId: string;
  date: string;
  quantity: number;
  /** Starts that are still ahead and have room for `quantity`. */
  starts: AvailabilityStart[];
}

export interface AvailabilityInput {
  offerId: string;
  date: string;
  quantity: number;
}

export interface OrderSummary {
  id: string;
  offerId: string;
  /** Guest language at the published revision, else the Offer's source title. */
  offerTitle: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
  date: string;
  startsAt: string | null;
  startsAtLocal: string | null;
  quantity: number;
  priceMinor: number | null;
  currency: string;
  createdAt: string;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isQuantity = (n: number) => Number.isInteger(n) && n >= 1 && n <= 999;
const todayIn = (now: Date, zone: string) =>
  DateTime.fromJSDate(now, { zone }).toISODate() as string;

async function stayContext(db: Executor, spaceId: string) {
  const [row] = await db
    .select({
      stayId: stays.id,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      zone: properties.timezone,
    })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(spaces.id, spaceId));
  if (!row) throw new ServiceRuleError('not-found');
  return row;
}

/** The checks both halves share, and every start of the day (passed ones included). */
async function startsOf(
  deps: { db: Executor; now: () => Date },
  ctx: ServiceContext,
  input: AvailabilityInput,
) {
  const offer = await getGuestOffer(deps.db, ctx.offerScope, input.offerId);
  if (!offer) throw new ServiceRuleError('offer-not-visible');
  const stay = await stayContext(deps.db, ctx.spaceId);
  if (!CIVIL_DATE.test(input.date) || !DateTime.fromISO(input.date).isValid) {
    throw new ServiceRuleError('invalid-input');
  }
  // ISO civil dates compare correctly as strings.
  if (input.date < stay.checkIn || input.date > stay.checkout) {
    throw new ServiceRuleError('date-outside-stay');
  }
  const now = deps.now();
  if (input.date < todayIn(now, stay.zone)) {
    throw new ServiceRuleError('date-past');
  }
  if (!isQuantity(input.quantity)) throw new ServiceRuleError('invalid-input');
  // Pay-online is ticket 33; on request and live are 36 and 37.
  if (offer.paymentMode === 'online') throw new ServiceRuleError('not-bookable-in-chat');
  let adapter: ReturnType<typeof adapterFor>;
  try {
    adapter = adapterFor(offer.availabilityMode);
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'not-supported') {
      throw new ServiceRuleError('not-bookable-in-chat');
    }
    throw error;
  }
  const all = await adapter.checkAvailability(
    { db: deps.db, now: deps.now },
    { offerId: offer.id, date: input.date, quantity: input.quantity, zone: stay.zone },
  );
  const starts = all.map((s) => ({
    slotId: s.slotId,
    startsAt: s.startsAt?.toISOString() ?? null,
    startsAtLocal: s.startsAt ? toLocalDateTime(s.startsAt, stay.zone) : null,
    remaining: s.remaining,
    passed: s.startsAt !== null && s.startsAt <= now,
  }));
  return { offer, stay, starts };
}

/** The starts of an Offer on a day of the Stay with room for `quantity`. */
export async function availabilityFor(
  deps: { db: Executor; now: () => Date },
  ctx: ServiceContext,
  input: AvailabilityInput,
): Promise<Availability> {
  const { offer, starts } = await startsOf(deps, ctx, input);
  return {
    offerId: offer.id,
    date: input.date,
    quantity: input.quantity,
    starts: starts.filter((s) => !s.passed).map(({ passed: _, ...s }) => s),
  };
}

function totalPrice(offer: GuestOffer, quantity: number): number | null {
  if (offer.priceMinor === null) return null;
  return offer.priceUnit === 'group' ? offer.priceMinor : offer.priceMinor * quantity;
}

/**
 * The first half: validates and stores a pending record bound to the space, valid for
 * PENDING_TTL_SECONDS. No other side effect: nothing is held until the guest's tap.
 */
export async function prepareOrder(
  deps: { db: Executor; now: () => Date },
  ctx: ServiceContext,
  input: AvailabilityInput & { slotId?: string },
): Promise<{ pendingId: string; draft: CreateOrderDraft }> {
  const { offer, stay, starts } = await startsOf(deps, ctx, input);
  let start: (typeof starts)[number] | undefined;
  if (input.slotId !== undefined) {
    start = starts.find((s) => s.slotId === input.slotId);
    if (!start) throw new ServiceRuleError('no-availability');
    if (start.passed) throw new ServiceRuleError('start-passed');
  } else {
    const ahead = starts.filter((s) => !s.passed);
    if (ahead.length === 0) throw new ServiceRuleError('no-availability');
    if (ahead.length > 1) throw new ServiceRuleError('choose-start');
    start = ahead[0];
  }
  if (!start) throw new ServiceRuleError('no-availability');

  const draft: CreateOrderDraft = {
    offerId: offer.id,
    offerTitle: offer.title,
    language: ctx.offerScope.language,
    date: input.date,
    slotId: start.slotId,
    startsAt: start.startsAt,
    startsAtLocal: start.startsAtLocal,
    quantity: input.quantity,
    priceMinor: totalPrice(offer, input.quantity),
    currency: offer.currency,
    priceUnit: offer.priceUnit,
    paymentMode: offer.paymentMode,
    availabilityMode: offer.availabilityMode,
    cancellationPolicy: offer.cancellationPolicy,
    contactFields: offer.contactFields,
  };
  const now = deps.now();
  const row = await insertPending(deps.db, {
    kind: 'create_order',
    spaceId: ctx.spaceId,
    stayId: stay.stayId,
    orderId: randomUUID(),
    payload: draft,
    expiresAt: new Date(now.getTime() + PENDING_TTL_SECONDS * 1000),
    now,
  });
  return { pendingId: row.id, draft };
}

/** A pending `create_order` record of this space with its draft; null when it is not one. */
export async function getPendingDraft(
  db: Executor,
  pendingId: string,
  spaceId: string,
): Promise<{
  state: PendingState;
  expiresAt: Date;
  orderId: string;
  draft: CreateOrderDraft;
} | null> {
  const [row] = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingId), eq(pendingActions.spaceId, spaceId)));
  if (row?.kind !== 'create_order') return null;
  return {
    state: row.state,
    expiresAt: row.expiresAt,
    orderId: row.orderId,
    draft: parsePayload(row),
  };
}

export interface GuestContact {
  email: string;
  name?: string;
  phone?: string;
}

/** Only the fields the Offer configures are kept; a configured one that is missing is null. */
function contactFor(draft: CreateOrderDraft, contact: GuestContact): GuestContact | null {
  const email = contact.email.trim();
  const name = contact.name?.trim();
  const phone = contact.phone?.trim();
  const wantsName = draft.contactFields !== 'phone';
  const wantsPhone = draft.contactFields !== 'name';
  if (!email || (wantsName && !name) || (wantsPhone && !phone)) return null;
  return {
    email,
    ...(wantsName ? { name } : {}),
    ...(wantsPhone ? { phone } : {}),
  };
}

const RULE_CODES: Partial<Record<OrderRuleError['code'], ServiceRuleCode>> = {
  'sold-out': 'no-availability',
  'date-outside-stay': 'date-outside-stay',
  'offer-inactive': 'offer-not-visible',
  'payment-mode-unsupported': 'not-bookable-in-chat',
};

type Completion =
  | { ok: true; orderId: string; replay: boolean }
  | { ok: false; code: ServiceRuleCode };

/**
 * The second half, on the guest's tap: consumes the pending record in the same transaction that
 * creates the Order, then commits the hold through the adapter outside it. A repeat (double tap,
 * re-sent request, concurrent retry) finds the record consumed and returns the same Order.
 */
export async function completeOrder(
  deps: OrderDeps,
  input: { pendingId: string; spaceId: string; offerScope: GuestOfferScope; contact: GuestContact },
): Promise<{ order: OrderSummary; replay: boolean }> {
  // Failures are returned from the transaction, not thrown, so a release is not rolled back.
  const result = await deps.db.transaction(async (tx): Promise<Completion> => {
    const row = await lockPending(tx, input.pendingId);
    if (!row || row.spaceId !== input.spaceId || row.kind !== 'create_order') {
      return { ok: false, code: 'not-found' };
    }
    if (row.state === 'consumed') return { ok: true, orderId: row.orderId, replay: true };
    if (row.state === 'released') return { ok: false, code: 'released' };
    const now = deps.now();
    if (row.expiresAt <= now) {
      await markPending(tx, row.id, 'released', now);
      return { ok: false, code: 'expired' };
    }
    const draft = parsePayload(row);
    // A card tapped late can outlive its day or its start: the first half's checks again.
    const { zone } = await stayContext(tx, row.spaceId);
    const passed =
      draft.date < todayIn(now, zone)
        ? 'date-past'
        : draft.startsAt && new Date(draft.startsAt) <= now
          ? 'start-passed'
          : null;
    if (passed) {
      await markPending(tx, row.id, 'released', now);
      return { ok: false, code: passed };
    }
    const contact = contactFor(draft, input.contact);
    if (!contact) return { ok: false, code: 'invalid-input' };
    // The scope can change between the halves (the Offer unpublished, the host's opt-out).
    if (!(await getGuestOffer(tx, input.offerScope, draft.offerId))) {
      await markPending(tx, row.id, 'released', now);
      return { ok: false, code: 'offer-not-visible' };
    }
    try {
      await createOrder(
        { db: tx, queue: deps.queue, now: deps.now },
        {
          id: row.orderId,
          spaceId: row.spaceId,
          offerId: draft.offerId,
          date: draft.date,
          slotId: draft.slotId ?? undefined,
          startsAt: draft.startsAt ? new Date(draft.startsAt) : undefined,
          quantity: draft.quantity,
          contact,
          hold: { expiresAt: new Date(now.getTime() + ORDER_HOLD_MINUTES * 60_000) },
        },
      );
    } catch (error) {
      // createOrder ran as a savepoint, so its writes are already rolled back.
      if (!(error instanceof OrderRuleError)) throw error;
      await markPending(tx, row.id, 'released', now);
      return { ok: false, code: RULE_CODES[error.code] ?? 'invalid-input' };
    }
    await markPending(tx, row.id, 'consumed', now);
    return { ok: true, orderId: row.orderId, replay: false };
  });
  if (!result.ok) throw new ServiceRuleError(result.code);

  // External commits run outside the transaction. A replay finishes a commit an earlier call
  // lost; confirmHeldOrder is idempotent.
  const created = await getOrder(deps.db, result.orderId);
  if (!created) throw new ServiceRuleError('not-found');
  if (created.order.status === 'confirming') {
    await confirmHeldOrder(deps, { orderId: created.order.id, proposalId: created.proposal.id });
  }
  const [order] = await summaries(
    deps.db,
    input.spaceId,
    input.offerScope.language,
    result.orderId,
  );
  if (!order) throw new ServiceRuleError('not-found');
  return { order, replay: result.replay };
}

/** Decline or cancel: pending → released for the owner. Returns the record's state, null when it is not theirs. */
export async function releasePendingOrder(
  db: Executor,
  input: { pendingId: string; spaceId: string; now: Date },
): Promise<PendingState | null> {
  const [released] = await db
    .update(pendingActions)
    .set({ state: 'released', resolvedAt: input.now })
    .where(
      and(
        eq(pendingActions.id, input.pendingId),
        eq(pendingActions.spaceId, input.spaceId),
        eq(pendingActions.state, 'pending'),
      ),
    )
    .returning({ state: pendingActions.state });
  if (released) return released.state;
  const [row] = await db
    .select({ state: pendingActions.state })
    .from(pendingActions)
    .where(and(eq(pendingActions.id, input.pendingId), eq(pendingActions.spaceId, input.spaceId)));
  return row?.state ?? null;
}

async function summaries(
  db: Executor,
  spaceId: string,
  language: GuestLanguage,
  orderId?: string,
): Promise<OrderSummary[]> {
  const rows = await db
    .select({
      order: orders,
      proposal: orderProposals,
      sourceTitle: offers.title,
      title: offerTranslations.title,
      zone: properties.timezone,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(
      offerTranslations,
      and(
        eq(offerTranslations.offerId, offers.id),
        eq(offerTranslations.revision, offers.publishedRevision),
        eq(offerTranslations.language, language),
      ),
    )
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(orders.spaceId, spaceId), orderId ? eq(orders.id, orderId) : undefined))
    .orderBy(desc(orders.createdAt), desc(orders.id));
  return rows.map(({ order, proposal, sourceTitle, title, zone }) => ({
    id: order.id,
    offerId: order.offerId,
    offerTitle: title ?? sourceTitle,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMode: order.paymentMode,
    date: proposal.date,
    startsAt: proposal.startsAt?.toISOString() ?? null,
    startsAtLocal: proposal.startsAt ? toLocalDateTime(proposal.startsAt, zone) : null,
    quantity: proposal.quantity,
    priceMinor: proposal.priceMinor,
    currency: proposal.currency,
    createdAt: order.createdAt.toISOString(),
  }));
}

/** One Order of the space, titled in `language`; null when it is not the space's. */
export async function getSpaceOrder(
  db: Executor,
  spaceId: string,
  language: GuestLanguage,
  orderId: string,
): Promise<OrderSummary | null> {
  const [order] = await summaries(db, spaceId, language, orderId);
  return order ?? null;
}

/** The space's Orders, newest first, titled in `language`. */
export function listSpaceOrders(
  db: Executor,
  spaceId: string,
  language: GuestLanguage,
): Promise<OrderSummary[]> {
  return summaries(db, spaceId, language);
}

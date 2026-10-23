import { and, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { destinations } from '../../db/schema/catalog';
import { offers, providers } from '../../db/schema/offers';
import { orderProposals, orders } from '../../db/schema/orders';
import { properties, units } from '../../db/schema/properties';
import { stays } from '../../db/schema/stays';
import { type GuestFields, guestFieldsFor } from '../../notifications/provider/compose';
import { PROVIDER_DEFAULTS, type PriceUnit, type ProviderLanguage } from '../../offers/vocabulary';
import { type OrderDeps, OrderRuleError, type TransitionOutcome } from '../../orders/machine';
import {
  type ProposedTerms,
  providerAccept,
  providerDecline,
  providerPropose,
} from '../../orders/provider-answers';
import { isFinalOrderStatus, type OrderStatus } from '../../orders/vocabulary';
import { type CivilDate, toLocalDateTime } from '../../time';
import { hashToken } from '../../tokens';
import { handleInboundCancellation } from '../adapters';
import { allotmentAdapter } from '../adapters/allotment';
import type { ProposalRef } from '../adapters/interface';
import { PROVIDER_LINK_TOKEN, providerLinkToken } from './token';

// The per-order Provider link: no login, only the token. The database keeps the token's hash, and
// every action is bound to the proposal the page showed, so a tap on an old page does nothing.

/** Stores the link's hash on first issue and returns the token, the same one on every call. */
export async function issueProviderLink(
  db: Executor,
  secret: string,
  orderId: string,
): Promise<string> {
  const token = providerLinkToken(secret, orderId);
  await db
    .update(orders)
    .set({ providerLinkTokenHash: hashToken(token) })
    .where(and(eq(orders.id, orderId), isNull(orders.providerLinkTokenHash)));
  return token;
}

/** The Order a link token opens, with what its page shows; undefined for any unknown token. */
export async function findOrderByLinkToken(db: Executor, token: string) {
  if (!PROVIDER_LINK_TOKEN.test(token)) return undefined;
  const [row] = await db
    .select({
      order: orders,
      proposal: orderProposals,
      offer: {
        title: offers.title,
        contactFields: offers.contactFields,
        orderKind: offers.orderKind,
        currency: offers.currency,
      },
      stay: { checkIn: stays.checkIn, checkout: stays.checkout },
      provider: { name: providers.name, email: providers.email, language: providers.language },
      destinationZone: destinations.timezone,
      propertyZone: properties.timezone,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .leftJoin(destinations, eq(destinations.id, offers.destinationId))
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(orders.providerLinkTokenHash, hashToken(token)));
  return row;
}

export type FoundProviderOrder = NonNullable<Awaited<ReturnType<typeof findOrderByLinkToken>>>;

export type ProviderLinkAction =
  | 'acknowledge'
  | 'cannot_fulfil'
  | 'accept'
  | 'decline'
  | 'suggest_time'
  | 'accept_with_price';

export interface ProviderLinkView {
  orderId: string;
  proposalId: string;
  providerName: string | null;
  /** The Provider's own language; the page may be shown in another. */
  language: ProviderLanguage;
  offerTitle: string;
  date: CivilDate;
  /** 'HH:mm' in the Offer's zone; null when the proposal has no start time. */
  startTime: string | null;
  quantity: number;
  priceUnit: PriceUnit;
  /** Empty once the Order is final: the link stays, the guest's contact details do not. */
  guest: GuestFields;
  status: OrderStatus;
  final: boolean;
  acknowledgedAt: Date | null;
  actions: ProviderLinkAction[];
  /** The proposal's total; null for a request-kind Order before the Provider names it. */
  priceMinor: number | null;
  currency: string;
  /** 'YYYY-MM-DDTHH:mm' in `zone` when the on-request answer is due; null otherwise. */
  respondBy: string | null;
  /** The stay's dates: a suggested date must lie between them. */
  stayFrom: CivilDate;
  stayTo: CivilDate;
  zone: string;
  /** New terms must carry a price: a request-kind Order, or a pay-online one without a price. */
  needsPrice: boolean;
}

/** What the Provider page shows: the current proposal and the actions open on it. */
export function providerLinkView(found: FoundProviderOrder): ProviderLinkView {
  const { order, proposal } = found;
  const zone = found.destinationZone ?? found.propertyZone;
  const final = isFinalOrderStatus(order.status);
  const open = order.status === 'confirmed' && order.availabilityMode === 'allotment';
  const asked = order.status === 'pending_provider' && order.availabilityMode === 'on_request';
  const requestKind = found.offer.orderKind === 'request';
  const actions: ProviderLinkAction[] = asked
    ? requestKind
      ? ['accept_with_price', 'suggest_time', 'decline']
      : ['accept', 'suggest_time', 'decline']
    : !open
      ? []
      : proposal.providerAcknowledgedAt
        ? ['cannot_fulfil']
        : ['acknowledge', 'cannot_fulfil'];
  return {
    orderId: order.id,
    proposalId: proposal.id,
    providerName: found.provider?.name ?? null,
    language: found.provider?.language ?? PROVIDER_DEFAULTS.language,
    offerTitle: found.offer.title,
    date: proposal.date,
    startTime: proposal.startsAt ? toLocalDateTime(proposal.startsAt, zone).slice(11) : null,
    quantity: proposal.quantity,
    priceUnit: order.priceUnit,
    guest: final ? {} : guestFieldsFor(found.offer.contactFields, order),
    status: order.status,
    final,
    acknowledgedAt: proposal.providerAcknowledgedAt,
    actions,
    priceMinor: proposal.priceMinor,
    currency: found.offer.currency,
    respondBy:
      asked && proposal.responseDueAt ? toLocalDateTime(proposal.responseDueAt, zone) : null,
    stayFrom: found.stay.checkIn,
    stayTo: found.stay.checkout,
    zone,
    needsPrice: requestKind || (order.paymentMode === 'online' && proposal.priceMinor === null),
  };
}

/**
 * Got it: records the Provider's acknowledgement of the current terms of a confirmed Order. Not
 * a status change, so no OrderEvent.
 */
export async function acknowledgeOrder(
  deps: OrderDeps,
  ref: ProposalRef,
): Promise<TransitionOutcome> {
  return deps.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, ref.orderId)).for('update');
    if (!order) throw new OrderRuleError('not-found');
    if (order.currentProposalId !== ref.proposalId) return { outcome: 'stale', order };
    if (order.status !== 'confirmed') return { outcome: 'rejected', order };
    const acknowledged = await tx
      .update(orderProposals)
      .set({ providerAcknowledgedAt: deps.now() })
      .where(
        and(eq(orderProposals.id, ref.proposalId), isNull(orderProposals.providerAcknowledgedAt)),
      )
      .returning({ id: orderProposals.id });
    return { outcome: acknowledged.length > 0 ? 'applied' : 'unchanged', order };
  });
}

/**
 * Can't fulfil: a Provider cancellation of the terms the page showed. The machine cancels the
 * Order, returns the seat, refunds a capture in full and alerts the admin.
 */
export async function cannotFulfil(deps: OrderDeps, ref: ProposalRef): Promise<TransitionOutcome> {
  const [order] = await deps.db.select().from(orders).where(eq(orders.id, ref.orderId));
  if (!order) throw new OrderRuleError('not-found');
  if (order.currentProposalId !== ref.proposalId) return { outcome: 'stale', order };
  // A final Order has no actions left, whoever closed it: the Provider recorded nothing here.
  if (isFinalOrderStatus(order.status)) return { outcome: 'rejected', order };
  // Other modes get their own Provider actions (36, 37).
  if (order.availabilityMode !== 'allotment') return { outcome: 'rejected', order };
  const result = await handleInboundCancellation(
    deps,
    allotmentAdapter,
    { reference: ref.orderId, proposalId: ref.proposalId },
    'provider_link',
    'provider cannot fulfil',
  );
  if (!result) throw new OrderRuleError('not-found');
  return result;
}

const LINK = { trigger: 'provider_link' } as const;

/** Accept on the per-order link: confirms an on-request Order on the terms the page showed. */
export function acceptOrder(deps: OrderDeps, ref: ProposalRef): Promise<TransitionOutcome> {
  return providerAccept(deps, ref, LINK);
}

/** Decline on the per-order link. */
export function declineOrder(deps: OrderDeps, ref: ProposalRef): Promise<TransitionOutcome> {
  return providerDecline(deps, ref, LINK);
}

/** Suggest another time or Accept with price on the per-order link: new terms for the guest. */
export function proposeOrder(
  deps: OrderDeps,
  ref: ProposalRef,
  terms: ProposedTerms,
): Promise<TransitionOutcome> {
  return providerPropose(deps, ref, terms, LINK);
}

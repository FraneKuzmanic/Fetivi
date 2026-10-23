import {
  availabilityFor,
  type GuestIdentity,
  listGuestOffers,
  listSpaceOrders,
} from '@fetivi/domain';
import { type GuestToolSpec, guestTool } from '../tool';
import { offerScope, refusing } from './create-order';
import {
  cancelOrderInput,
  cancelOrderOutput,
  checkAvailabilityInput,
  checkAvailabilityOutput,
  createOrderInput,
  createOrderOutput,
  listMyOrdersInput,
  listMyOrdersOutput,
  listOffersInput,
  listOffersOutput,
  respondToOrderUpdateInput,
  respondToOrderUpdateOutput,
} from './schemas';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const scoped = (scope: string) => (identity: GuestIdentity) => identity.scopes.includes(scope);

/** create_order: its two halves live in create-order.ts, since the guest confirms between them. */
export const createOrderSpec: GuestToolSpec = guestTool({
  name: 'create_order',
  config: {
    title: 'Order',
    description:
      'Book an offer for the guest. The guest confirms in the app, giving their email and the contact details the provider needs; nothing is booked until they tap Confirm. Never say an order is booked without an `ordered` outcome. Pass slotId from check_availability when the day has more than one start.',
    scope: 'orders:create',
    inputSchema: createOrderInput,
    outputSchema: createOrderOutput,
    // It only adds an Order, after the guest's tap. A new call with the same arguments is a
    // new booking; retries of one call are deduplicated server-side. It reaches the Provider.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  listed: scoped('orders:create'),
  confirm: true,
});

/** cancel_order: its two halves live in cancel.ts, since the guest confirms between them. */
export const cancelOrderSpec: GuestToolSpec = guestTool({
  name: 'cancel_order',
  config: {
    title: 'Cancel order',
    description:
      "Cancel one of the guest's orders. The guest sees the cancellation policy and the refund on a card and confirms; nothing changes until they tap Cancel booking. Never promise a refund amount yourself, and never say it is cancelled without a `cancelled` outcome.",
    scope: 'orders:manage',
    inputSchema: cancelOrderInput,
    outputSchema: cancelOrderOutput,
    // It ends an Order and may move money, after the guest's tap. Cancelling a cancelled Order
    // changes nothing more. It reaches the Provider (and its booking system for a live Offer).
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  listed: scoped('orders:manage'),
  confirm: true,
});

/** respond_to_order_update: its two halves live in respond.ts, since the guest answers between them. */
export const respondToOrderUpdateSpec: GuestToolSpec = guestTool({
  name: 'respond_to_order_update',
  config: {
    title: 'Answer new terms',
    description:
      "Show the guest the provider's new time or price for an order and let them accept or decline it on a card. Accepting confirms the order (online payment opens a new secure checkout); declining cancels it. Never say it is confirmed without an `accepted` outcome.",
    scope: 'orders:manage',
    inputSchema: respondToOrderUpdateInput,
    outputSchema: respondToOrderUpdateOutput,
    // It confirms or cancels an Order after the guest's tap; a repeat returns the same answer.
    // It reaches the Provider.
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  listed: scoped('orders:manage'),
  confirm: true,
});

/** The `services` server's tools, in `tools/list` order. */
export const servicesTools: readonly GuestToolSpec[] = [
  guestTool({
    name: 'list_offers',
    config: {
      title: 'List offers',
      description:
        "Services the guest can arrange through Fetivi: boat trips, tours, tastings, transfers, rentals and more, with price, cancellation policy and the contact details the provider needs. Filter by category, or by a place's id from search_places. Offers with availabilityMode allotment or on_request can be booked in chat; an on_request one waits for the provider's answer within a response window, and the provider may propose a new time or price. paymentMode online ones are paid on a secure page after the guest confirms.",
      scope: 'offers:read',
      inputSchema: listOffersInput,
      outputSchema: listOffersOutput,
      annotations: readOnly,
    },
    listed: scoped('offers:read'),
    async handler(args, identity, { db }) {
      return { offers: await listGuestOffers(db, offerScope(identity), args) };
    },
  }),
  guestTool({
    name: 'check_availability',
    config: {
      title: 'Check availability',
      description:
        'The start times of an offer on a day of the stay that still have room for the party, with local times and places left. Call it before create_order and let the guest pick a start.',
      scope: 'offers:read',
      inputSchema: checkAvailabilityInput,
      outputSchema: checkAvailabilityOutput,
      annotations: { ...readOnly, openWorldHint: true },
    },
    listed: scoped('offers:read'),
    handler(args, identity, { db, now }) {
      const ctx = { spaceId: identity.spaceId, offerScope: offerScope(identity) };
      return refusing(() => availabilityFor({ db, now }, ctx, args));
    },
  }),
  guestTool({
    name: 'list_my_orders',
    config: {
      title: 'My orders',
      description:
        "The guest's orders in this stay, newest first, with status, day, local start time, party size and total.",
      scope: 'orders:read',
      inputSchema: listMyOrdersInput,
      outputSchema: listMyOrdersOutput,
      annotations: readOnly,
    },
    listed: scoped('orders:read'),
    async handler(_args, identity, { db }) {
      return { orders: await listSpaceOrders(db, identity.spaceId, identity.language) };
    },
  }),
  createOrderSpec,
  cancelOrderSpec,
  respondToOrderUpdateSpec,
];

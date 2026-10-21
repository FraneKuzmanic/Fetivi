import {
  availabilityFor,
  type CreateOrderDraft,
  completeOrder,
  type Db,
  type GuestIdentity,
  type GuestOfferScope,
  getPendingDraft,
  getSpaceOrder,
  type JobQueue,
  listGuestOffers,
  listSpaceOrders,
  prepareOrder,
  releasePendingOrder,
  type ServiceRuleCode,
  ServiceRuleError,
} from '@fetivi/domain';
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server';
import {
  ClaimMismatchError,
  GuestToolError,
  registerGuestConfirmTool,
  registerGuestTool,
} from '../tool';
import { SERVER_VERSION } from '../version';
import {
  CONFIRM_KEY,
  clientCanElicitForm,
  confirmationMessage,
  contactSchemaFor,
  createOrderStateCodec,
  orderDraftMeta,
} from './elicitation';
import {
  checkAvailabilityInput,
  checkAvailabilityOutput,
  createOrderInput,
  createOrderOutput,
  listMyOrdersInput,
  listMyOrdersOutput,
  listOffersInput,
  listOffersOutput,
} from './schemas';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const REFUSALS: Record<Exclude<ServiceRuleCode, 'offer-not-visible' | 'not-found'>, string> = {
  'date-outside-stay': "That date is outside the guest's stay.",
  'date-past': 'That date has passed.',
  'not-bookable-in-chat': "This offer can't be booked in chat yet; share its details instead.",
  'no-availability': 'No places left for that start and party size.',
  'choose-start': 'That day has several start times: call check_availability and pass slotId.',
  'start-passed': 'That start time has passed.',
  'invalid-input': 'The booking details were incomplete.',
  expired: 'The confirmation expired; nothing was booked. Offer to try again.',
  released: 'That confirmation was already cancelled; nothing was booked.',
};

const NO_ELICITATION =
  'This app cannot show a booking confirmation, so nothing was booked. The guest can book in the Fetivi app.';

/** Domain refusals as tool errors; an id the caller may not see is `not permitted`. */
async function refusing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ServiceRuleError)) throw error;
    if (error.code === 'offer-not-visible' || error.code === 'not-found') {
      throw new ClaimMismatchError(error.code);
    }
    throw new GuestToolError(REFUSALS[error.code]);
  }
}

/**
 * The `services` server for one guest: Offers, availability, the guest's Orders and create_order
 * (architecture §4.4). Each tool is listed only while the token carries its scope, so after
 * checkout only list_my_orders remains. Visible Offers: the destination's Provider Offers plus
 * the host's own, or only the host's own outside a destination.
 */
export function buildServicesServer(
  identity: GuestIdentity,
  deps: { db: Db; queue: JobQueue; now: () => Date; requestStateSecret: string },
): McpServer {
  const { db, queue, now } = deps;
  const codec = createOrderStateCodec(deps.requestStateSecret, identity.spaceId);
  const server = new McpServer(
    { name: 'fetivi-services', version: SERVER_VERSION },
    // A tampered, expired or other space's requestState dies here with -32602.
    { capabilities: { tools: {} }, requestState: { verify: codec.verify } },
  );
  const offerScope: GuestOfferScope = {
    destinationId: identity.destinationId,
    propertyId: identity.propertyId,
    language: identity.language,
  };
  const ctx = { spaceId: identity.spaceId, offerScope };

  if (identity.scopes.includes('offers:read')) {
    registerGuestTool(
      server,
      identity,
      'list_offers',
      {
        title: 'List offers',
        description:
          "Services the guest can arrange through Fetivi: boat trips, tours, tastings, transfers, rentals and more, with price, cancellation policy and the contact details the provider needs. Filter by category, or by a place's id from search_places. Only offers with availabilityMode allotment and paymentMode direct can be booked in chat now.",
        scope: 'offers:read',
        inputSchema: listOffersInput,
        outputSchema: listOffersOutput,
        annotations: readOnly,
      },
      async (args) => ({ offers: await listGuestOffers(db, offerScope, args) }),
    );

    registerGuestTool(
      server,
      identity,
      'check_availability',
      {
        title: 'Check availability',
        description:
          'The start times of an offer on a day of the stay that still have room for the party, with local times and places left. Call it before create_order and let the guest pick a start.',
        scope: 'offers:read',
        inputSchema: checkAvailabilityInput,
        outputSchema: checkAvailabilityOutput,
        annotations: { ...readOnly, openWorldHint: true },
      },
      (args) => refusing(() => availabilityFor({ db, now }, ctx, args)),
    );
  }

  if (identity.scopes.includes('orders:read')) {
    registerGuestTool(
      server,
      identity,
      'list_my_orders',
      {
        title: 'My orders',
        description:
          "The guest's orders in this stay, newest first, with status, day, local start time, party size and total.",
        scope: 'orders:read',
        inputSchema: listMyOrdersInput,
        outputSchema: listMyOrdersOutput,
        annotations: readOnly,
      },
      async () => ({ orders: await listSpaceOrders(db, identity.spaceId, identity.language) }),
    );
  }

  if (identity.scopes.includes('orders:create')) {
    /** The confirmation card for a stored draft, with a freshly sealed state. */
    const ask = async (pendingId: string, draft: CreateOrderDraft, request: ServerContext) =>
      inputRequired({
        inputRequests: {
          [CONFIRM_KEY]: inputRequired.elicit({
            message: confirmationMessage(draft),
            requestedSchema: contactSchemaFor(draft.contactFields),
            _meta: orderDraftMeta(pendingId, draft),
          }),
        },
        requestState: await codec.mint({ pendingId }, request),
      });

    /** A record an earlier tap already consumed: its Order, never a "not ordered". */
    const alreadyOrdered = async (orderId: string) => {
      const order = await getSpaceOrder(db, identity.spaceId, identity.language, orderId);
      if (!order) throw new ClaimMismatchError('not-found');
      return { outcome: 'ordered' as const, order };
    };

    /** The guest's answer: only the stored record and the answer count, never the arguments. */
    const resume = async (pendingId: string, request: ServerContext) => {
      const pending = await getPendingDraft(db, pendingId, identity.spaceId);
      if (!pending) throw new ClaimMismatchError('not-found');
      const answer = inputResponse(request.mcpReq.inputResponses, CONFIRM_KEY);
      if (answer.kind === 'elicit' && answer.action !== 'accept') {
        const state = await releasePendingOrder(db, {
          pendingId,
          spaceId: identity.spaceId,
          now: now(),
        });
        if (state === 'consumed') return alreadyOrdered(pending.orderId);
        return { outcome: 'not_ordered' as const, order: null };
      }
      const contact = acceptedContent(
        request.mcpReq.inputResponses,
        CONFIRM_KEY,
        contactSchemaFor(pending.draft.contactFields),
      );
      if (!contact) {
        // A missing or invalid answer gets the same card again, only while the record is open.
        if (pending.state === 'consumed') return alreadyOrdered(pending.orderId);
        if (pending.state === 'released') throw new GuestToolError(REFUSALS.released);
        if (pending.expiresAt <= now()) {
          await releasePendingOrder(db, { pendingId, spaceId: identity.spaceId, now: now() });
          throw new GuestToolError(REFUSALS.expired);
        }
        return ask(pendingId, pending.draft, request);
      }
      const { order } = await refusing(() =>
        completeOrder({ db, queue, now }, { pendingId, ...ctx, contact }),
      );
      return { outcome: 'ordered' as const, order };
    };

    registerGuestConfirmTool(
      server,
      identity,
      'create_order',
      {
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
      async (args, _identity, request) => {
        const state = request.mcpReq.requestState<{ pendingId: string }>();
        if (state) return resume(state.pendingId, request);
        // Before anything is stored: a client that cannot show the card never leaves a record (S5).
        if (!clientCanElicitForm(request, server)) throw new GuestToolError(NO_ELICITATION);
        const { pendingId, draft } = await refusing(() => prepareOrder({ db, now }, ctx, args));
        return ask(pendingId, draft, request);
      },
    );
  }

  return server;
}

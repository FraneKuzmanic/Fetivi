import {
  CONFIRM_KEY,
  type CreateOrderDraft,
  completeOrder,
  type GuestIdentity,
  type GuestOfferScope,
  getPendingDraft,
  getSpaceOrder,
  prepareOrder,
  releasePendingOrder,
  type ServiceRuleCode,
  ServiceRuleError,
} from '@fetivi/domain';
import { type InputRequiredResult, inputRequired } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { StateCodec } from '../request-state';
import { ClaimMismatchError, GuestToolError, type ToolDeps } from '../tool';
import { confirmationMessage, contactSchemaFor, orderDraftMeta } from './elicitation';
import type { createOrderInput, createOrderOutput } from './schemas';

export type CreateOrderOutput = z.infer<typeof createOrderOutput>;

// The two halves of create_order (architecture §4.3), shared by the services server (over MCP
// elicitation) and V0 (through the chat backend's pending-record handler): one completion rule.

export const REFUSALS: Record<
  Exclude<ServiceRuleCode, 'offer-not-visible' | 'not-found'>,
  string
> = {
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

export const NO_ELICITATION =
  'This app cannot show a booking confirmation, so nothing was booked. The guest can book in the Fetivi app.';

/** Domain refusals as tool errors; an id the caller may not see is `not permitted`. */
export async function refusing<T>(run: () => Promise<T>): Promise<T> {
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

/** The Offers a guest sees: the destination's Provider Offers plus the host's own. */
export function offerScope(identity: GuestIdentity): GuestOfferScope {
  return {
    destinationId: identity.destinationId,
    propertyId: identity.propertyId,
    language: identity.language,
  };
}

/** The guest's answer to the card; `action` is absent when the answer was missing. */
export interface OrderAnswer {
  action?: 'accept' | 'decline' | 'cancel';
  content?: unknown;
}

/** The confirmation card for a stored draft, with a freshly sealed state. */
async function ask(
  codec: StateCodec,
  pendingId: string,
  draft: CreateOrderDraft,
): Promise<InputRequiredResult> {
  return inputRequired({
    inputRequests: {
      [CONFIRM_KEY]: inputRequired.elicit({
        message: confirmationMessage(draft),
        requestedSchema: contactSchemaFor(draft.contactFields),
        _meta: orderDraftMeta(pendingId, draft),
      }),
    },
    requestState: await codec.mint({ pendingId }),
  });
}

/** The first half: store the draft as a pending record and answer the card. */
export async function prepareCreateOrder(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  args: z.infer<typeof createOrderInput>,
): Promise<InputRequiredResult> {
  const ctx = { spaceId: identity.spaceId, offerScope: offerScope(identity) };
  const { pendingId, draft } = await refusing(() =>
    prepareOrder({ db: deps.db, now: deps.now }, ctx, args),
  );
  return ask(codec, pendingId, draft);
}

/** A record an earlier tap already consumed: its Order, never a "not ordered". */
async function alreadyOrdered(deps: ToolDeps, identity: GuestIdentity, orderId: string) {
  const order = await getSpaceOrder(deps.db, identity.spaceId, identity.language, orderId);
  if (!order) throw new ClaimMismatchError('not-found');
  return { outcome: 'ordered' as const, order };
}

/** The guest's answer: only the stored record and the answer count, never the arguments. */
export async function answerCreateOrder(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  pendingId: string,
  answer: OrderAnswer,
): Promise<CreateOrderOutput | InputRequiredResult> {
  const { db, queue, now } = deps;
  const spaceId = identity.spaceId;
  const pending = await getPendingDraft(db, pendingId, spaceId);
  if (!pending) throw new ClaimMismatchError('not-found');
  if (answer.action !== undefined && answer.action !== 'accept') {
    const state = await releasePendingOrder(db, { pendingId, spaceId, now: now() });
    if (state === 'consumed') return alreadyOrdered(deps, identity, pending.orderId);
    return { outcome: 'not_ordered' as const, order: null };
  }
  const parsed =
    answer.action === 'accept' && answer.content !== undefined
      ? contactSchemaFor(pending.draft.contactFields).safeParse(answer.content)
      : undefined;
  if (!parsed?.success) {
    // A missing or invalid answer gets the same card again, only while the record is open.
    if (pending.state === 'consumed') return alreadyOrdered(deps, identity, pending.orderId);
    if (pending.state === 'released') throw new GuestToolError(REFUSALS.released);
    if (pending.expiresAt <= now()) {
      await releasePendingOrder(db, { pendingId, spaceId, now: now() });
      throw new GuestToolError(REFUSALS.expired);
    }
    return ask(codec, pendingId, pending.draft);
  }
  const { order } = await refusing(() =>
    completeOrder(
      { db, queue, now },
      { pendingId, spaceId, offerScope: offerScope(identity), contact: parsed.data },
    ),
  );
  return { outcome: 'ordered' as const, order };
}

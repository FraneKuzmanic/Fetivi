import {
  CANCEL_DRAFT_META_KEY,
  type CancelOrderDraft,
  type CancelRuleCode,
  CancelRuleError,
  CONFIRM_KEY,
  completeCancel,
  type GuestIdentity,
  getPendingCancel,
  getSpaceOrder,
  prepareCancel,
  releasePending,
} from '@fetivi/domain';
import { type InputRequiredResult, inputRequired } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { StateCodec } from '../request-state';
import { ClaimMismatchError, GuestToolError, type ToolDeps } from '../tool';
import type { cancelOrderInput, cancelOrderOutput } from './schemas';
import { termsSentence } from './terms';

export type CancelOrderOutput = z.infer<typeof cancelOrderOutput>;

// The two halves of cancel_order (35), shared by the services server and V0 like create_order's.
// The card shows the refund computed from the rules snapshotted on the Order; the tap recomputes
// it and re-asks when it changed, so the guest only ever gets the refund they confirmed.

export const CANCEL_REFUSALS: Record<Exclude<CancelRuleCode, 'not-found'>, string> = {
  'not-cancellable': "This order can't be cancelled any more.",
  'being-confirmed': 'This order is being confirmed right now; try again in a minute.',
  started:
    "This order has already started; it can't be cancelled here. The guest can contact the provider.",
  'after-checkout':
    'After checkout only orders that are still waiting for an answer can be cancelled.',
  expired: 'The cancellation card expired; nothing was cancelled.',
  released: 'That cancellation was already closed; nothing was cancelled.',
};

export const NO_CANCEL_ELICITATION =
  'This app cannot show the cancellation card, so nothing was cancelled. The guest can cancel in the Fetivi app.';

/** Domain refusals as tool errors; an Order the caller may not see is `not permitted`. */
async function refusingCancel<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CancelRuleError)) throw error;
    if (error.code === 'not-found') throw new ClaimMismatchError(error.code);
    throw new GuestToolError(CANCEL_REFUSALS[error.code]);
  }
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

/** An English one-liner from the stored draft, never from model text; the card localises. */
export function cancelMessage(draft: CancelOrderDraft): string {
  const when = draft.startsAtLocal
    ? `${draft.date} at ${draft.startsAtLocal.slice(11)}`
    : draft.date;
  const terms = termsSentence(draft.cancellation, draft.paymentMode);
  let cost: string;
  // Pay-direct: no card is held, so the terms say what cancelling costs, never a refund.
  if (draft.paymentMode === 'direct') cost = `It was paid directly to the provider. ${terms}`;
  else if (draft.refundMinor === null) cost = 'Nothing was paid yet, so cancelling costs nothing.';
  else if (draft.refundMinor === 0) cost = 'Nothing is refunded under this policy.';
  else
    cost = `You get back ${money(draft.refundMinor, draft.currency)} (${draft.refundPercent} %).`;
  return `Cancel ${draft.offerTitle} on ${when} for ${draft.quantity}? ${cost}`.trimEnd();
}

/** The card has nothing to fill in: the tap is the answer. */
export const CANCEL_FORM = { type: 'object' as const, properties: {} };

/** The card for a stored draft, with a freshly sealed state. */
async function askCancel(
  codec: StateCodec,
  pendingId: string,
  draft: CancelOrderDraft,
): Promise<InputRequiredResult> {
  return inputRequired({
    inputRequests: {
      [CONFIRM_KEY]: inputRequired.elicit({
        message: cancelMessage(draft),
        requestedSchema: CANCEL_FORM,
        _meta: { [CANCEL_DRAFT_META_KEY]: { pendingId, ...draft } },
      }),
    },
    requestState: await codec.mint({ pendingId }),
  });
}

/** The first half: check the Order, compute the refund, store it and answer the card. */
export async function prepareCancelOrder(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  args: z.infer<typeof cancelOrderInput>,
): Promise<InputRequiredResult> {
  const { pendingId, draft } = await refusingCancel(() =>
    prepareCancel(
      { db: deps.db, now: deps.now },
      { spaceId: identity.spaceId, language: identity.language },
      { orderId: args.orderId },
    ),
  );
  return askCancel(codec, pendingId, draft);
}

/** A record an earlier tap already consumed: the cancelled Order, never a "not cancelled". */
async function alreadyCancelled(deps: ToolDeps, identity: GuestIdentity, orderId: string) {
  const order = await getSpaceOrder(deps.db, identity.spaceId, identity.language, orderId);
  if (!order) throw new ClaimMismatchError('not-found');
  return { outcome: 'cancelled' as const, order };
}

/** The guest's answer: only the stored record and the tap count, never the arguments. */
export async function answerCancelOrder(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  pendingId: string,
  answer: { action?: 'accept' | 'decline' | 'cancel'; content?: unknown },
): Promise<CancelOrderOutput | InputRequiredResult> {
  const { db, queue, now } = deps;
  const spaceId = identity.spaceId;
  // Requires kind cancel_order, so a state minted for another tool never completes this one.
  const pending = await getPendingCancel(db, pendingId, spaceId);
  if (!pending) throw new ClaimMismatchError('not-found');
  const orderId = pending.draft.orderId;
  if (answer.action !== undefined && answer.action !== 'accept') {
    const state = await releasePending(db, { pendingId, spaceId, now: now() });
    if (state === 'consumed') return alreadyCancelled(deps, identity, orderId);
    return { outcome: 'not_cancelled' as const, order: null };
  }
  if (answer.action === undefined) {
    // A missing answer gets the same card again, only while the record is open.
    if (pending.state === 'consumed') return alreadyCancelled(deps, identity, orderId);
    if (pending.state === 'released') throw new GuestToolError(CANCEL_REFUSALS.released);
    if (pending.expiresAt <= now()) {
      await releasePending(db, { pendingId, spaceId, now: now() });
      throw new GuestToolError(CANCEL_REFUSALS.expired);
    }
    return askCancel(codec, pendingId, pending.draft);
  }
  const result = await refusingCancel(() =>
    completeCancel({ db, queue, now }, { pendingId, spaceId }),
  );
  // The cutoff passed while the card was open: the guest sees the new amount and taps again.
  if (result.outcome === 'changed') return askCancel(codec, pendingId, result.draft);
  return { outcome: 'cancelled' as const, order: result.order };
}

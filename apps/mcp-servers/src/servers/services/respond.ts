import {
  CONFIRM_KEY,
  completeRespond,
  type GuestIdentity,
  getPendingRespond,
  prepareRespond,
  RESPOND_ANSWERS,
  RESPOND_DRAFT_META_KEY,
  type RespondAnswer,
  type RespondOrderDraft,
  type RespondRuleCode,
  RespondRuleError,
  releasePending,
} from '@fetivi/domain';
import { type InputRequiredResult, inputRequired } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { StateCodec } from '../request-state';
import { ClaimMismatchError, GuestToolError, type ToolDeps } from '../tool';
import type { respondToOrderUpdateInput, respondToOrderUpdateOutput } from './schemas';
import { termsSentence } from './terms';

export type RespondToOrderUpdateOutput = z.infer<typeof respondToOrderUpdateOutput>;

// The two halves of respond_to_order_update (36), shared by the services server and V0 like
// cancel_order's. The card shows the Provider's (or the admin's) new terms next to the old ones;
// the guest's `answer` field accepts or declines them. MCP decline/cancel means "not now" and
// leaves the Order as it is.

export const RESPOND_REFUSALS: Record<Exclude<RespondRuleCode, 'not-found'>, string> = {
  'no-update': 'This order has no new terms to answer.',
  stale: 'The provider changed the terms again; nothing was changed. Show the new terms.',
  'card-expired': 'The time to answer these terms has passed; the order expired.',
  expired: 'The card expired; nothing was changed.',
  released: 'That card was already closed; nothing was changed.',
};

export const NO_RESPOND_ELICITATION =
  "This app cannot show the card for the provider's new terms, so nothing was changed. The guest can answer in the Fetivi app.";

/** Domain refusals as tool errors; an Order the caller may not see is `not permitted`. */
async function refusingRespond<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof RespondRuleError)) throw error;
    if (error.code === 'not-found') throw new ClaimMismatchError(error.code);
    throw new GuestToolError(RESPOND_REFUSALS[error.code]);
  }
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

const when = (date: string, startsAtLocal: string | null) =>
  startsAtLocal ? `${date} at ${startsAtLocal.slice(11)}` : date;

/** An English one-liner from the stored draft, never from model text; the card localises. */
export function respondMessage(draft: RespondOrderDraft): string {
  const price = draft.priceMinor === null ? '' : ` for ${money(draft.priceMinor, draft.currency)}`;
  const was = when(draft.previous.date, draft.previous.startsAtLocal);
  return `New terms for ${draft.offerTitle}: ${when(draft.date, draft.startsAtLocal)}${price}, for ${draft.quantity} (was ${was}). Answer by ${draft.respondByLocal.replace('T', ' ')}. ${termsSentence(draft.cancellation, draft.paymentMode)}`.trimEnd();
}

/** One required answer: accepting or declining the terms, distinct from "not now". */
export const RESPOND_FORM = {
  type: 'object' as const,
  properties: {
    answer: {
      type: 'string' as const,
      title: 'Your answer',
      enum: [...RESPOND_ANSWERS],
      enumNames: ['Accept the new terms', 'Decline and cancel the order'],
    },
  },
  required: ['answer'],
};

/** The card for a stored draft, with a freshly sealed state. */
async function askRespond(
  codec: StateCodec,
  pendingId: string,
  draft: RespondOrderDraft,
): Promise<InputRequiredResult> {
  return inputRequired({
    inputRequests: {
      [CONFIRM_KEY]: inputRequired.elicit({
        message: respondMessage(draft),
        requestedSchema: RESPOND_FORM,
        _meta: { [RESPOND_DRAFT_META_KEY]: { pendingId, ...draft } },
      }),
    },
    requestState: await codec.mint({ pendingId }),
  });
}

/** The first half: check the Order has new terms to answer, store them and answer the card. */
export async function prepareRespondToOrderUpdate(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  args: z.infer<typeof respondToOrderUpdateInput>,
): Promise<InputRequiredResult> {
  const { pendingId, draft } = await refusingRespond(() =>
    prepareRespond(
      { db: deps.db, now: deps.now },
      { spaceId: identity.spaceId, language: identity.language },
      { orderId: args.orderId },
    ),
  );
  return askRespond(codec, pendingId, draft);
}

/** The answer in the card's content, if it is one. */
function answerOf(content: unknown): RespondAnswer | undefined {
  const value = (content as { answer?: unknown } | null | undefined)?.answer;
  return RESPOND_ANSWERS.find((answer) => answer === value);
}

/** The guest's answer: only the stored record and the card's `answer` count, never the arguments. */
export async function answerRespondToOrderUpdate(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  pendingId: string,
  answer: { action?: 'accept' | 'decline' | 'cancel'; content?: unknown },
): Promise<RespondToOrderUpdateOutput | InputRequiredResult> {
  const { db, queue, now } = deps;
  const spaceId = identity.spaceId;
  const complete = async (given: RespondAnswer) => {
    // A consumed record returns the answer it was given, whatever this call carries.
    const result = await refusingRespond(() =>
      completeRespond({ db, queue, now }, { pendingId, spaceId, answer: given }),
    );
    return { outcome: result.outcome, order: result.order };
  };
  // Requires kind respond_to_order_update, so a state minted for another tool never completes it.
  const pending = await getPendingRespond(db, pendingId, spaceId);
  if (!pending) throw new ClaimMismatchError('not-found');
  if (pending.state === 'consumed') return complete('accept');
  if (answer.action !== undefined && answer.action !== 'accept') {
    const state = await releasePending(db, { pendingId, spaceId, now: now() });
    if (state === 'consumed') return complete('accept');
    return { outcome: 'not_answered' as const, order: null };
  }
  const given = answerOf(answer.content);
  if (given === undefined) {
    // A missing answer gets the same card again, only while the record is open.
    if (pending.state === 'released') throw new GuestToolError(RESPOND_REFUSALS.released);
    if (pending.expiresAt <= now()) {
      await releasePending(db, { pendingId, spaceId, now: now() });
      throw new GuestToolError(RESPOND_REFUSALS.expired);
    }
    return askRespond(codec, pendingId, pending.draft);
  }
  return complete(given);
}

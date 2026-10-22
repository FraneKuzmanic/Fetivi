import {
  CONFIRM_KEY,
  completeHostMessage,
  type GuestIdentity,
  getPendingHostMessage,
  getSentHostMessage,
  HANDOFF_LIMITS,
  type HandoffRuleCode,
  HandoffRuleError,
  HOST_MESSAGE_DRAFT_META_KEY,
  HOST_MESSAGE_KEY,
  type HostMessageDraft,
  prepareHostMessage,
  releasePending,
} from '@fetivi/domain';
import { type InputRequiredResult, inputRequired } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { StateCodec } from '../request-state';
import { ClaimMismatchError, GuestToolError, type ToolDeps } from '../tool';
import type { sendHostMessageInput, sendHostMessageOutput } from './schemas';

export type SendHostMessageOutput = z.infer<typeof sendHostMessageOutput>;

// The two halves of send_host_message (architecture §4.3), shared by the stay server and V0 like
// create_order's. The card shows the stored draft; the guest's text is the only thing sent.

export const HOST_MESSAGE_REFUSALS: Record<Exclude<HandoffRuleCode, 'not-found'>, string> = {
  'already-sent':
    "The guest already sent the host a message in this conversation; don't offer another. Point them to the host's phone with show_property_info (contacts).",
  'already-replied': 'The host already replied to this message.',
  'invalid-input': 'The message was empty or too long; nothing was sent.',
  expired: 'The message card expired; nothing was sent. Offer to draft it again.',
  released: 'That message card was already closed; nothing was sent.',
};

export const NO_HOST_ELICITATION =
  'This app cannot show the message card, so nothing was sent. The guest can message the host in the Fetivi app.';

/** Domain refusals as tool errors; a record the caller may not see is `not permitted`. */
export async function refusingHandoff<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof HandoffRuleError)) throw error;
    if (error.code === 'not-found') throw new ClaimMismatchError(error.code);
    throw new GuestToolError(HOST_MESSAGE_REFUSALS[error.code]);
  }
}

/** Form mode: one string, prefilled with the draft. Urgency is Fetivi's, so it is not a field. */
export function hostMessageForm(draft: HostMessageDraft) {
  return {
    type: 'object' as const,
    properties: {
      [HOST_MESSAGE_KEY]: {
        type: 'string' as const,
        title: 'Message',
        maxLength: HANDOFF_LIMITS.messageChars,
        default: draft.text,
      },
    },
    required: [HOST_MESSAGE_KEY],
  };
}

const answerContent = z.object({
  [HOST_MESSAGE_KEY]: z.string().trim().min(1).max(HANDOFF_LIMITS.messageChars),
});

/** The card for a stored draft, with a freshly sealed state. */
async function askHostMessage(
  codec: StateCodec,
  pendingId: string,
  draft: HostMessageDraft,
): Promise<InputRequiredResult> {
  return inputRequired({
    inputRequests: {
      [CONFIRM_KEY]: inputRequired.elicit({
        message: 'Send this message to your host?',
        requestedSchema: hostMessageForm(draft),
        _meta: { [HOST_MESSAGE_DRAFT_META_KEY]: { pendingId, ...draft } },
      }),
    },
    requestState: await codec.mint({ pendingId }),
  });
}

/** The first half: store the draft as a pending record and answer the card. */
export async function prepareSendHostMessage(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  args: z.infer<typeof sendHostMessageInput>,
): Promise<InputRequiredResult> {
  const { pendingId, draft } = await refusingHandoff(() =>
    prepareHostMessage(
      { db: deps.db, now: deps.now },
      { spaceId: identity.spaceId, language: identity.language },
      { text: args.message, reason: args.reason, urgency: args.urgency },
    ),
  );
  return askHostMessage(codec, pendingId, draft);
}

/** A record an earlier tap already consumed: its message, never a "not sent". */
async function alreadySent(deps: ToolDeps, identity: GuestIdentity, draft: HostMessageDraft) {
  const message = await getSentHostMessage(deps.db, identity.spaceId, draft.messageId);
  if (!message) throw new ClaimMismatchError('not-found');
  return { outcome: 'sent' as const, message };
}

/** The guest's answer: only the stored record and the guest's text count, never the arguments. */
export async function answerSendHostMessage(
  deps: ToolDeps,
  identity: GuestIdentity,
  codec: StateCodec,
  pendingId: string,
  answer: { action?: 'accept' | 'decline' | 'cancel'; content?: unknown },
): Promise<SendHostMessageOutput | InputRequiredResult> {
  const { db, queue, now } = deps;
  const spaceId = identity.spaceId;
  const pending = await getPendingHostMessage(db, pendingId, spaceId);
  if (!pending) throw new ClaimMismatchError('not-found');
  if (answer.action !== undefined && answer.action !== 'accept') {
    const state = await releasePending(db, { pendingId, spaceId, now: now() });
    if (state === 'consumed') return alreadySent(deps, identity, pending.draft);
    return { outcome: 'not_sent' as const, message: null };
  }
  const parsed =
    answer.action === 'accept' && answer.content !== undefined
      ? answerContent.safeParse(answer.content)
      : undefined;
  if (!parsed?.success) {
    // A missing or invalid answer gets the same card again, only while the record is open.
    if (pending.state === 'consumed') return alreadySent(deps, identity, pending.draft);
    if (pending.state === 'released') throw new GuestToolError(HOST_MESSAGE_REFUSALS.released);
    if (pending.expiresAt <= now()) {
      await releasePending(db, { pendingId, spaceId, now: now() });
      throw new GuestToolError(HOST_MESSAGE_REFUSALS.expired);
    }
    return askHostMessage(codec, pendingId, pending.draft);
  }
  const { message } = await refusingHandoff(() =>
    completeHostMessage({ db, queue, now }, { pendingId, spaceId, text: parsed.data.message }),
  );
  return { outcome: 'sent' as const, message };
}

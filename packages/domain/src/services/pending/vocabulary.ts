// The approved-action binding's controlled lists (architecture §4.3). Imports nothing, so the
// pgEnums are built from it.

/** What a pending record will do once the guest confirms. Tickets 23, 35 and 36 add kinds. */
export const PENDING_ACTION_KINDS = ['create_order'] as const;
export type PendingActionKind = (typeof PENDING_ACTION_KINDS)[number];

export const PENDING_STATES = ['pending', 'consumed', 'released'] as const;
export type PendingState = (typeof PENDING_STATES)[number];

/** How long a confirmation card works; also the `requestState` codec's TTL. */
export const PENDING_TTL_SECONDS = 600;

/** The allotment hold placed at the guest's tap. It is committed right after, so this only bounds a lost commit. */
export const ORDER_HOLD_MINUTES = 15;

/** A tool definition's `_meta` flag: the host pauses the model on this tool and lets the guest confirm. */
export const GUEST_CONFIRMS_META_KEY = 'app.fetivi/guest-confirms';

/** Where the confirmation card reads the structured draft: the elicitation request's `_meta`. */
export const ORDER_DRAFT_META_KEY = 'app.fetivi/order-draft';

/** The key of the one input request create_order sends. */
export const CONFIRM_KEY = 'confirm';

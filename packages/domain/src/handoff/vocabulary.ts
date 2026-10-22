// The Host message's controlled lists (architecture §4.2 HandoffMessage). Imports nothing, so the
// pgEnums are built from it and `@fetivi/ui/payloads` can read it without the domain.

/** Why the guest needs the host (PRD §6.5). There is deliberately no "local question" value. */
export const HANDOFF_REASONS = ['property_question', 'problem', 'request', 'guest_asked'] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

/** What the host reads for each reason, in the Inbox and in host emails and pushes. */
export const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  property_question: 'Question about the unit',
  problem: 'Problem',
  request: 'Request',
  guest_asked: 'Asked to contact you',
};

/** Set by Fetivi, never by the guest. `urgent` bypasses the host's digest. */
export const HANDOFF_URGENCIES = ['normal', 'urgent'] as const;
export type HandoffUrgency = (typeof HANDOFF_URGENCIES)[number];

export const HANDOFF_TRANSLATION_STATES = ['pending', 'done', 'not_needed', 'failed'] as const;
export type HandoffTranslationState = (typeof HANDOFF_TRANSLATION_STATES)[number];

export const HANDOFF_LIMITS = { messageChars: 1000, replyChars: 2000 } as const;

/** Where the host message card reads the stored draft: the elicitation request's `_meta`. */
export const HOST_MESSAGE_DRAFT_META_KEY = 'app.fetivi/host-message-draft';

/** The one form field of the host message card. */
export const HOST_MESSAGE_KEY = 'message';

/** The part type of an inbox message in the Conversation (a host reply). */
export const INBOX_PART_TYPE = 'data-inbox';

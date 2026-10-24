// Answer feedback's controlled lists (ticket 43). Imports nothing, like the other vocabulary
// files, so the pgEnums are built from it and the web apps can bundle it.

export const THUMBS = ['up', 'down'] as const;
export type Thumb = (typeof THUMBS)[number];

/** The one-tap reasons, offered after a thumbs down (43 AC 1). */
export const FEEDBACK_REASONS = ['wrong', 'outdated', 'not_helpful'] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** Reasons that flag the answer's catalog places for curation (43 AC 2; 39's guest_flagged payload). */
export const FLAGGING_REASONS = ['outdated', 'wrong'] as const satisfies readonly FeedbackReason[];
export type FlaggingReason = (typeof FLAGGING_REASONS)[number];

export const isFlaggingReason = (r: FeedbackReason | null): r is FlaggingReason =>
  r !== null && (FLAGGING_REASONS as readonly string[]).includes(r);

/**
 * What an answer was about, derived from the tools it used; never from the guest's words.
 * The place categories repeat PLACE_CATEGORIES plus day_trip (this file imports nothing; a
 * unit test checks they match).
 */
export const ANSWER_TOPICS = [
  'arrival',
  'wifi',
  'checkout',
  'contacts',
  'places',
  'beach',
  'restaurant',
  'cafe_bar',
  'sight',
  'nature',
  'activity',
  'shop',
  'nightlife',
  'day_trip',
  'host_picks',
  'events',
  'weather',
  'transport',
  'web_search',
  'services',
  'orders',
  'host_message',
  'plan',
  'about_me',
  'general',
] as const;
export type AnswerTopic = (typeof ANSWER_TOPICS)[number];

export const TOP_TOPICS_LIMIT = 8;
export const STATS_STAY_LIMIT = 50;

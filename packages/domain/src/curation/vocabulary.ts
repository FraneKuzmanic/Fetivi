// The admin curation queue's controlled lists (architecture §4.2). Imports nothing, like the
// other vocabulary files, so the pgEnums are built from it. 38 adds host Provider suggestions;
// 39 builds the queue and the other kinds' producers.

/** Ticket 39 AC 1's six kinds. */
export const CURATION_KINDS = [
  'draft',
  'refresh_diff',
  'guest_flagged',
  'host_place_suggestion',
  'host_provider_suggestion',
  'fallback_topic_cluster',
] as const;
export type CurationKind = (typeof CURATION_KINDS)[number];

export const CURATION_STATUSES = ['open', 'approved', 'rejected', 'needs_visit'] as const;
export type CurationStatus = (typeof CURATION_STATUSES)[number];

/** Character limits of a host's Provider suggestion. */
export const CURATION_LIMITS = {
  suggestionName: 120,
  suggestionContact: 200,
  suggestionNote: 1000,
} as const;

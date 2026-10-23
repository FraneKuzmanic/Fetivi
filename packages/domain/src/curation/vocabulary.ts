// The admin curation queue's controlled lists and payload types (architecture §4.2). Imports
// nothing, like the other vocabulary files, so the pgEnums are built from it and the web can
// bundle it.

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

export const CURATION_ACTIONS = ['approve', 'edit', 'reject', 'needs_visit'] as const;
export type CurationAction = (typeof CURATION_ACTIONS)[number];

/** Kinds tied to a catalog record; approving one stamps the record's verified_at. */
export const KINDS_WITH_RECORD = [
  'draft',
  'refresh_diff',
  'guest_flagged',
  'host_place_suggestion',
] as const satisfies readonly CurationKind[];

export const isRecordKind = (kind: CurationKind): boolean =>
  (KINDS_WITH_RECORD as readonly CurationKind[]).includes(kind);

/** Edit exists only where there is a record to edit. */
export const CURATION_KIND_ACTIONS = Object.fromEntries(
  CURATION_KINDS.map((kind): [CurationKind, readonly CurationAction[]] => [
    kind,
    isRecordKind(kind) ? CURATION_ACTIONS : CURATION_ACTIONS.filter((a) => a !== 'edit'),
  ]),
) as Record<CurationKind, readonly CurationAction[]>;

/** Approved and rejected are final; an item that needs a visit stays reviewable. */
export const REVIEWABLE_STATUSES = [
  'open',
  'needs_visit',
] as const satisfies readonly CurationStatus[];

export const isReviewable = (status: CurationStatus): boolean =>
  (REVIEWABLE_STATUSES as readonly CurationStatus[]).includes(status);

/** The admin's status filter; `done` is approved or rejected. */
export const CURATION_TABS = ['open', 'needs_visit', 'done'] as const;
export type CurationTab = (typeof CURATION_TABS)[number];

/** The record fields a draft or refresh diff may propose. */
export const CURATED_TEXT_FIELDS = [
  'title',
  'description',
  'address',
  'phone',
  'websiteUrl',
  'venueName',
] as const;
export type CuratedTextField = (typeof CURATED_TEXT_FIELDS)[number];

export type CuratedChanges = Partial<Record<CuratedTextField, string>> & {
  /** Source URL per field, merged into the record's field_sources. */
  fieldSources?: Partial<Record<string, string>>;
};

/** What each kind carries. */
export type CurationPayload =
  | { kind: 'draft'; changes: CuratedChanges }
  | { kind: 'refresh_diff'; changes: CuratedChanges; previous: CuratedChanges }
  | { kind: 'guest_flagged'; reason: 'outdated' | 'wrong'; count: number }
  | {
      kind: 'host_place_suggestion';
      name: string;
      /** A PLACE_CATEGORIES code, checked on approve (this file imports nothing). */
      placeCategory: string;
      location: { lat: number; lng: number };
      address: string | null;
      note: string | null;
    }
  | { kind: 'host_provider_suggestion'; name: string; contact: string | null; note: string | null }
  | {
      kind: 'fallback_topic_cluster';
      /** The most frequent raw topic of the group. */
      topic: string;
      topics: string[];
      places: string[];
      count: number;
      noResults: number;
      /** The UTC ISO week's Monday, YYYY-MM-DD. */
      weekStart: string;
    };

/** A record within this many days of its staleness budget is near it. */
export const STALENESS_NEAR_DAYS = 14;
/** Recommendations in this many days count toward the staleness ranking. */
export const RECOMMENDATION_WINDOW_DAYS = 90;
export const STALENESS_QUEUE_LIMIT = 200;
export const CURATION_LIST_LIMIT = 200;
/** Sample topics and places kept per fallback cluster. */
export const CLUSTER_SAMPLE_LIMIT = 5;
/** Monday 03:00 UTC: clusters the previous ISO week's fallback topics. */
export const CLUSTER_FALLBACKS_CRON = '0 3 * * 1';

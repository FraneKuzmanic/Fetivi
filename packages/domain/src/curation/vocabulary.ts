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

/**
 * What the queue offers for one item. A draft without a record (a Seeding candidate, ADR 0019)
 * has nothing to approve or edit until the drafting job has filled it (42), so until then it
 * offers only Reject.
 */
export function curationItemActions(
  kind: CurationKind,
  hasRecord: boolean,
  drafted = false,
): readonly CurationAction[] {
  return kind === 'draft' && !hasRecord && !drafted ? ['reject'] : CURATION_KIND_ACTIONS[kind];
}

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

/** One opening-hours row of a draft; mirrors the catalog store's OpeningHoursInput. */
export interface DraftedHours {
  weekday: number;
  opens: string;
  closes: string;
  validFrom: string | null;
  validTo: string | null;
}

/** One season range of a draft; mirrors the catalog store's SeasonInput. */
export interface DraftedSeason {
  fromMonth: number;
  fromDay: number;
  toMonth: number;
  toDay: number;
}

/** A Wikimedia Commons image of a draft (the only image source drafting uses, 42). */
export interface DraftedImage {
  url: string;
  licence: string;
  attribution: string;
  sourcePageUrl: string;
}

export type CuratedChanges = Partial<Record<CuratedTextField, string>> & {
  openingHours?: DraftedHours[];
  seasons?: DraftedSeason[];
  /** Source URL per field, merged into the record's field_sources. */
  fieldSources?: Partial<Record<string, string>>;
};

/** What each kind carries. */
export type CurationPayload =
  | {
      kind: 'draft';
      changes: CuratedChanges;
      /** The Seeding candidate it drafts (41); 42 creates the record on approve. */
      candidateId?: string;
      /** A candidate draft's category and location, from its open-data rows (ADR 0020). */
      place?: {
        placeCategory: string;
        location: { lat: number; lng: number };
        locationSourceUrl: string | null;
      };
      /** Wikimedia Commons only. */
      images?: DraftedImage[];
      /** The drafting job's outcome; `pages` lists the fetched URLs, for the admin. */
      drafting?: { status: 'drafted' | 'no_sources' | 'failed'; at: string; pages: string[] };
    }
  | {
      kind: 'refresh_diff';
      changes: CuratedChanges;
      previous: CuratedChanges;
      /** The drafting run that found the diff (42). */
      runId?: string;
    }
  | { kind: 'guest_flagged'; reason: 'outdated' | 'wrong'; count: number }
  | {
      kind: 'host_place_suggestion';
      name: string;
      /** A PLACE_CATEGORIES code, checked on approve (this file imports nothing). */
      placeCategory: string;
      location: { lat: number; lng: number };
      address: string | null;
      note: string | null;
      /** The host place this suggestion came from (40); approve links it to the new record. */
      hostPlaceId?: string;
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

/**
 * A candidate draft the drafting job filled with at least a title and a place, so Approve can
 * create its record.
 */
export const isDrafted = (p: CurationPayload): boolean =>
  p.kind === 'draft' &&
  p.drafting?.status === 'drafted' &&
  typeof p.changes.title === 'string' &&
  p.place !== undefined;

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

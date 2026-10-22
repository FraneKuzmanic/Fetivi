// Day plan codes and limits. Imports nothing: the guest SPA bundles this file through the
// `@fetivi/domain/plan-vocabulary` subpath.

/** A suggestion agreed in chat, or a booked Order shown on its day. */
export const PLAN_ITEM_KINDS = ['suggestion', 'order'] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

/** Bounds on stored model text and on one update_plan call; the plan_items checks mirror them. */
export const PLAN_LIMITS = {
  titleChars: 80,
  noteChars: 280,
  suggestionsPerDay: 12,
  opsPerCall: 20,
} as const;

/** A local start time at the property, 'HH:mm' (24 h). */
export const PLAN_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

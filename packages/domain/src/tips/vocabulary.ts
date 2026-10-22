// Daily tip vocabulary: the rules, their order, the send window and the facts a tip carries.
// Imports only types: `@fetivi/ui/payloads` and guest-web bundle this file through the
// `@fetivi/domain/tips-vocabulary` subpath.

import type { CivilDate } from '../time';
import type { SkyCode } from '../weather/vocabulary';

/** The rules, in priority order: the first one with a candidate wins. */
export const TIP_RULES = ['rain', 'event', 'gap'] as const;
export type TipRule = (typeof TIP_RULES)[number];

/** Skies that make tomorrow a rainy day. Light rain does not spoil a day. */
export const RAINY_SKIES = [
  'rain',
  'heavy_rain',
  'showers',
  'thunder',
] as const satisfies readonly SkyCode[];

/**
 * Property-local send window: tips go out from 17:00; a run that missed the slot catches up
 * until 21:00, later is too late to be welcome.
 */
export const TIP_SEND_TIME = '17:00';
export const TIP_SEND_UNTIL = '21:00';

/** The daily-tips cron (UTC); due spaces are picked up within 15 minutes of 17:00 local. */
export const DAILY_TIPS_CRON = '*/15 * * * *';

/** A space counts as used when the guest chatted within this window. */
export const ACTIVE_WITHIN_MS = 48 * 60 * 60 * 1000;

export const TIP_RECORD_KINDS = ['place', 'day_trip', 'event'] as const;
export type TipRecordKind = (typeof TIP_RECORD_KINDS)[number];

/** What a daily tip says, fixed at pick time: the catalog may change before send. */
export interface DailyTipFacts {
  rule: TipRule;
  /** Tomorrow, the day the tip is about. */
  date: CivilDate;
  recordId: string;
  kind: TipRecordKind;
  /** The catalog title in the space language. */
  title: string;
  /** Events only: 'YYYY-MM-DDTHH:mm' in the destination zone. */
  startsAt: string | null;
  venueName: string | null;
  distanceKm: number | null;
}

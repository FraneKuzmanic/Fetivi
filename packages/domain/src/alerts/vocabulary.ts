// Safety alert vocabulary: ferry lines, operators and the alert facts. Imports only types: the
// guest SPA and the back office bundle this file through the `@fetivi/domain/alerts-vocabulary`
// subpath.
//
// Ferryhopper's `get_disruptions` is deliberately not a source: spike S3 found it empty for
// Croatia over a week. Disruptions come from Jadrolinija's RSS feed only, behind a flag until
// Jadrolinija gives written permission to poll it.

import type { WarningLevel, WarningType } from '../weather/vocabulary';

export const FERRY_OPERATORS = ['jadrolinija', 'tp_line', 'krilo', 'bura_line', 'other'] as const;
export type FerryOperator = (typeof FERRY_OPERATORS)[number];

/** The operator's name and its own line-status page; no phone numbers (none verified). */
export const FERRY_OPERATOR_INFO: Record<FerryOperator, { name: string; url: string | null }> = {
  jadrolinija: {
    name: 'Jadrolinija',
    url: 'https://www.jadrolinija.hr/hr/obavijesti/stanje-u-prometu/',
  },
  tp_line: { name: 'TP Line', url: 'https://www.tp-line.hr/hr/stanjelinija' },
  krilo: { name: 'Krilo', url: 'https://www.krilo.hr/' },
  bura_line: { name: 'Bura Line', url: 'https://www.buraline.com/infos' },
  other: { name: 'the operator', url: null },
};

export interface FerryLine {
  /** The state line number, or a slug for a line without one. */
  id: string;
  operator: FerryOperator;
  mode: 'ferry' | 'catamaran';
  route: string;
}

/**
 * Lines a visit from the pilot area (Trogir, Split) may depend on. Routes from agencija-zolpp.hr
 * "Linije 2026", operators from jadrolinija.hr/hr/putovanja and tp-line.hr (checked 2026-10-22).
 * Left out: 9601 (Milna – Rogač – Sutivan – Split) and 9602 (Vis – Hvar – Milna – Split), whose
 * operator neither source names. Another destination adds rows here, nothing else.
 */
export const FERRY_LINES = [
  { id: '602', operator: 'jadrolinija', mode: 'ferry', route: 'Split – Vis' },
  {
    id: '604',
    operator: 'jadrolinija',
    mode: 'ferry',
    route: 'Split – Hvar – Vela Luka – Ubli (Lastovo)',
  },
  {
    id: '606',
    operator: 'jadrolinija',
    mode: 'ferry',
    route: 'Trogir (Soline) – Drvenik Mali – Drvenik Veli',
  },
  { id: '631', operator: 'jadrolinija', mode: 'ferry', route: 'Split – Supetar' },
  { id: '635', operator: 'jadrolinija', mode: 'ferry', route: 'Split – Stari Grad' },
  { id: '636', operator: 'jadrolinija', mode: 'ferry', route: 'Split – Rogač' },
  {
    id: '9603',
    operator: 'jadrolinija',
    mode: 'catamaran',
    route: 'Split – Bol – Stari Grad – Jelsa',
  },
  {
    id: '9604',
    operator: 'tp_line',
    mode: 'catamaran',
    route: 'Split – Hvar – Vela Luka – Ubli (Lastovo)',
  },
  {
    id: '9608',
    operator: 'tp_line',
    mode: 'catamaran',
    route: 'Split – Hvar – Prigradica – Korčula',
  },
  { id: 'bura-line', operator: 'bura_line', mode: 'catamaran', route: 'Trogir – Slatine – Split' },
] as const satisfies readonly FerryLine[];

export type FerryLineId = (typeof FERRY_LINES)[number]['id'];

/** The ids as a tuple, for `z.enum`. */
export const FERRY_LINE_IDS = FERRY_LINES.map((line) => line.id) as unknown as readonly [
  FerryLineId,
  ...FerryLineId[],
];

export function ferryLine(id: string): FerryLine | null {
  return FERRY_LINES.find((line) => line.id === id) ?? null;
}

export const SAFETY_ALERT_KINDS = ['weather_warning', 'ferry_disruption'] as const;
export type SafetyAlertKind = (typeof SAFETY_ALERT_KINDS)[number];

/** The safety-alerts cron (UTC). DHMZ warnings live 10 minutes in the feed cache. */
export const SAFETY_ALERTS_CRON = '*/10 * * * *';

export const JADROLINIJA_FEED = 'https://www.jadrolinija.hr/feeds/vijesti';
export const JADROLINIJA_HOST = 'www.jadrolinija.hr';

/** A plan item or booked Order that depends on one or more lines. */
export interface AffectedItem {
  /** In the space language. */
  title: string;
  /** Civil date 'YYYY-MM-DD'. */
  date: string;
  /** 'HH:mm' property time. */
  startTime: string | null;
  /** Set when the item is a booked Order. */
  orderId: string | null;
  /** FERRY_LINES ids. */
  lines: string[];
}

export interface WarningAlertFacts {
  source: 'DHMZ';
  level: WarningLevel;
  type: WarningType;
  /** DHMZ's own words, Croatian for a hr space, else English. */
  event: string;
  description: string;
  area: string;
  /** ISO instants. */
  onset: string;
  expires: string;
  /** The property's zone, for showing the times. */
  timezone: string;
  /** Wind warnings only: a plan item or Order that depends on a line during the warning. */
  advisory: AffectedItem | null;
}

export interface DisruptionAlertFacts {
  source: 'Jadrolinija';
  /** The RSS guid, else its link. */
  noticeId: string;
  /** As published (Croatian), never translated. */
  title: string;
  /** https://www.jadrolinija.hr/... only. */
  url: string;
  timezone: string;
  affected: AffectedItem;
}

export type SafetyAlertFacts = WarningAlertFacts | DisruptionAlertFacts;

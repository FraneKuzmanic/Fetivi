import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { CivilDate } from '../time';
import { normaliseStation } from './areas';
import { WeatherFeedError } from './errors';
import { WARNING_LEVELS, WARNING_TYPES, type WarningLevel, type WarningType } from './vocabulary';

// DHMZ (the Croatian meteorological service) XML feeds: sea temperature and UV as station-by-hour
// tables, and official warnings as OASIS CAP 1.2 in the MeteoAlarm convention. Open Licence: the
// only condition is crediting DHMZ. The parsers are pure; fetching and caching live in source.ts.

export const DHMZ_FEEDS = {
  sea: 'https://vrijeme.hr/more_n.xml',
  uv: 'https://vrijeme.hr/uvi.xml',
  warnings: [
    'https://meteo.hr/upozorenja/cap_hr_today.xml',
    'https://meteo.hr/upozorenja/cap_hr_tomorrow.xml',
    'https://meteo.hr/upozorenja/cap_hr_day_after_tomorrow.xml',
  ],
} as const;

const ARRAY_TAGS = new Set(['Podatci', 'Termin', 'info', 'area', 'geocode', 'parameter']);

// `parseTagValue: false` keeps "07" and "20.0" as strings; numbers are parsed here.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;

function parseXml(xml: string, root: string): Node {
  if (XMLValidator.validate(xml) !== true) throw new WeatherFeedError(`malformed XML (${root})`);
  const doc = parser.parse(xml) as Node;
  const node = doc[root];
  if (!node || typeof node !== 'object') throw new WeatherFeedError(`missing <${root}>`);
  return node as Node;
}

/** A text node's value: a plain string, or `#text` when the element has attributes. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '#text' in value) return String(value['#text']).trim();
  return '';
}

function list(value: unknown): Node[] {
  return Array.isArray(value) ? (value as Node[]) : [];
}

function number(value: unknown): number | null {
  const raw = text(value);
  if (raw === '' || raw === '-') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---- Station tables (sea temperature, UV) ----

export interface StationTable {
  date: CivilDate;
  /** Local hours of the columns, e.g. '07'. */
  hours: string[];
  rows: { station: string; values: (number | null)[] }[];
}

export interface StationReading {
  value: number;
  /** Local 'yyyy-mm-ddTHH:00' (DHMZ hours are Croatian local time). */
  measuredAt: string;
}

const DATUM = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** Parses `more_n.xml` or `uvi.xml`. The first `Podatci` row is the header of hours. */
export function parseStationTable(
  xml: string,
  root: 'Temperature_mora' | 'UV_indeks',
): StationTable {
  const node = parseXml(xml, root);
  const datum = DATUM.exec(text(node.Datum));
  if (!datum) throw new WeatherFeedError(`bad Datum in <${root}>`);
  const [header, ...rows] = list(node.Podatci);
  if (!header) throw new WeatherFeedError(`no rows in <${root}>`);
  return {
    date: `${datum[3]}-${datum[2]}-${datum[1]}`,
    hours: list(header.Termin).map((cell) => text(cell).padStart(2, '0')),
    rows: rows.map((row) => ({
      station: text(row.Postaja),
      values: list(row.Termin).map(number),
    })),
  };
}

function rowOf(table: StationTable, station: string) {
  const key = normaliseStation(station);
  return table.rows.find((row) => normaliseStation(row.station) === key) ?? null;
}

function reading(table: StationTable, index: number, value: number): StationReading {
  return { value, measuredAt: `${table.date}T${table.hours[index] ?? '00'}:00` };
}

/** The station's last value of the day, or null when it has none. */
export function latestReading(table: StationTable, station: string): StationReading | null {
  const row = rowOf(table, station);
  if (!row) return null;
  for (let i = row.values.length - 1; i >= 0; i--) {
    const value = row.values[i];
    if (value != null) return reading(table, i, value);
  }
  return null;
}

/** The station's highest value so far today (UV), or null when it has none. */
export function maxReading(table: StationTable, station: string): StationReading | null {
  const row = rowOf(table, station);
  if (!row) return null;
  let best: StationReading | null = null;
  row.values.forEach((value, i) => {
    if (value != null && (best === null || value > best.value)) best = reading(table, i, value);
  });
  return best;
}

// ---- CAP warnings ----

export interface CapWarning {
  language: string;
  event: string;
  description: string;
  level: WarningLevel;
  type: WarningType;
  /** ISO instants. */
  onset: string;
  expires: string;
  /** EMMA_ID regions with their names, in the info's language. */
  areas: { id: string; name: string }[];
}

function parameter(info: Node, name: string): string {
  const match = list(info.parameter).find((p) => text(p.valueName) === name);
  return match ? text(match.value) : '';
}

/** "2; yellow; Moderate" → yellow. Green (1), missing or unknown → null: not shown. */
function levelOf(value: string): WarningLevel | null {
  const name = value.split(';')[1]?.trim().toLowerCase();
  return WARNING_LEVELS.find((level) => level === name) ?? null;
}

/** "1; Wind" → wind (MeteoAlarm types 1 to 13, in WARNING_TYPES order). */
function typeOf(value: string): WarningType {
  const index = Number.parseInt(value.split(';')[0] ?? '', 10);
  return WARNING_TYPES[index - 1] ?? 'other';
}

/** "2026-10-22 08:00:00+02:00" (DHMZ writes a space) → ISO instant, or null. */
function instant(value: string): string | null {
  if (!value) return null;
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * One warning per CAP `info` at level yellow or above. `areas` takes the EMMA_ID geocodes only:
 * DHMZ also sends NUTS3 codes, which reuse the HRxxx form for other regions.
 */
export function parseCapWarnings(xml: string): CapWarning[] {
  const alert = parseXml(xml, 'alert');
  const warnings: CapWarning[] = [];
  for (const info of list(alert.info)) {
    const level = levelOf(parameter(info, 'awareness_level'));
    const onset = instant(text(info.onset));
    const expires = instant(text(info.expires));
    if (!level || !onset || !expires) continue;
    const areas = list(info.area).flatMap((area) => {
      const emma = list(area.geocode).find((g) => text(g.valueName) === 'EMMA_ID');
      return emma ? [{ id: text(emma.value), name: text(area.areaDesc) }] : [];
    });
    warnings.push({
      language: text(info.language),
      event: text(info.event),
      description: text(info.description),
      level,
      type: typeOf(parameter(info, 'awareness_type')),
      onset,
      expires,
      areas,
    });
  }
  return warnings;
}

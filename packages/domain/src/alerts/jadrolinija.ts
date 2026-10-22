import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DateTime } from 'luxon';
import { stripMarkup } from '../property/sanitize';
import type { CivilDate } from '../time';
import { FERRY_LINES, FERRY_OPERATOR_INFO, type FerryOperator } from './vocabulary';

// Jadrolinija's news RSS feed (`JADROLINIJA_FEED`): RSS 2.0 with the Atom namespace as `a10`, free
// Croatian text, no line ids, and usually a single item. Everything in it is untrusted: it never
// reaches the model, and only an item's title and a vetted link go into alert facts. The parser is
// pure; fetching lives in the safety-alerts job.

export class FerryFeedError extends Error {
  override name = 'FerryFeedError';
}

export interface FerryBulletin {
  /** The guid, else the link. */
  id: string;
  title: string;
  /** An https jadrolinija.hr page: the item's own link, else the official status page. */
  url: string;
  /** Title and body as plain text, for finding lines and dates. */
  text: string;
  /** Croatian local time 'yyyy-mm-ddTHH:mm'. */
  publishedLocal: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'item',
});

type Node = Record<string, unknown>;

/** A text node's value: a plain string, or `#text` when the element has attributes. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '#text' in value) return String(value['#text']).trim();
  return '';
}

const JADROLINIJA_HOSTS = new Set(['www.jadrolinija.hr', 'jadrolinija.hr']);

function vettedUrl(link: string): string {
  try {
    const url = new URL(link);
    if (url.protocol === 'https:' && JADROLINIJA_HOSTS.has(url.hostname)) return url.href;
  } catch {
    // Not a URL: the official page stands in.
  }
  return FERRY_OPERATOR_INFO.jadrolinija.url as string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PUB_DATE = /(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2})/;

/**
 * The wall-clock fields of an RFC 822 pubDate. Jadrolinija labels Croatian local time "Z"
 * (seen in the recorded feed), so the zone is ignored.
 */
function localPubDate(value: string): string | null {
  const match = PUB_DATE.exec(value);
  if (!match) return null;
  const [, day, monthName, year, hour, minute] = match as unknown as string[];
  const month = MONTHS.indexOf(monthName as string) + 1;
  const local = DateTime.fromObject({
    year: Number(year),
    month,
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  });
  return month > 0 && local.isValid ? local.toFormat("yyyy-MM-dd'T'HH:mm") : null;
}

/** The feed's items; an item without a title, an id or a readable pubDate is skipped. */
export function parseJadrolinijaFeed(xml: string): FerryBulletin[] {
  if (XMLValidator.validate(xml) !== true) throw new FerryFeedError('malformed XML (rss)');
  const doc = parser.parse(xml) as Node;
  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  if (!channel || typeof channel !== 'object') throw new FerryFeedError('missing <rss><channel>');
  const items = Array.isArray(channel.item) ? (channel.item as Node[]) : [];
  const bulletins: FerryBulletin[] = [];
  for (const item of items) {
    const title = stripMarkup(text(item.title), { singleLine: true });
    const link = text(item.link);
    const id = text(item.guid) || link;
    const publishedLocal = localPubDate(text(item.pubDate));
    if (!title || !id || !publishedLocal) continue;
    const body = [text(item.description), text(item['a10:content'])]
      .map((part) => stripMarkup(part))
      .filter((part) => part !== '' && part !== title);
    bulletins.push({
      id,
      title,
      url: vettedUrl(link),
      text: [title, ...body].join('\n'),
      publishedLocal,
    });
  }
  return bulletins;
}

/** Line ids of `operator` named in `text`; the table filters out years, times and dates. */
export function linesIn(text: string, operator: FerryOperator): string[] {
  const named = new Set(text.match(/\b\d{3,4}\b/g) ?? []);
  return FERRY_LINES.filter((line) => line.operator === operator && named.has(line.id)).map(
    (line) => line.id,
  );
}

/** Every valid d.m.yyyy date in `text`, once each; none → `[fallback]`. */
export function datesIn(text: string, fallback: CivilDate): CivilDate[] {
  const dates = new Set<CivilDate>();
  for (const match of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\.?/g)) {
    const date = DateTime.fromObject({
      year: Number(match[3]),
      month: Number(match[2]),
      day: Number(match[1]),
    });
    if (date.isValid) dates.add(date.toISODate() as CivilDate);
  }
  return dates.size > 0 ? [...dates] : [fallback];
}

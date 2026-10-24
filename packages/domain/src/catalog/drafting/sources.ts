import { hostUnder } from '../../fallback/results';
import { FALLBACK_SITES, VENUE_HOST_DENYLIST } from '../../fallback/vocabulary';
import { DRAFTING_LIMITS, SOCIAL_HOSTS } from './vocabulary';

// Which pages a drafting task may read (ADR 0020): a place's own website and socials, and any
// tourist-board page its rows or record name. Pure: the hosts become the task's egress allowlist.

export type SourceKind = 'venue' | 'social' | 'tourist_board';
export interface SourceRef {
  url: string;
  kind: SourceKind;
}

/** The parts of an open-data row drafting reads. Its own `sourceUrl` is open data, never a page. */
export interface SourceRow {
  source: string;
  data: Record<string, unknown>;
  sourceUrl?: string | null;
}

const WEBSITE_TAGS = ['website', 'contact:website', 'url'] as const;
const SOCIAL_TAGS: readonly [string, string][] = [
  ['contact:facebook', 'facebook.com'],
  ['facebook', 'facebook.com'],
  ['contact:instagram', 'instagram.com'],
  ['instagram', 'instagram.com'],
];

/** Open-data hosts: their pages describe the dataset, not the venue. */
const OPEN_DATA_HOSTS = ['openstreetmap.org', 'europa.eu', 'overturemaps.org'] as const;

const TOURIST_BOARD_HOSTS = FALLBACK_SITES.filter((s) => s.kind === 'tourist_board').map(
  (s) => s.host,
);

const KIND_ORDER: Record<SourceKind, number> = { venue: 0, tourist_board: 1, social: 2 };

/** A bare handle (`konobatrs`, `@konoba.trs`) has no slash and no known host in it. */
function socialUrl(value: string, base: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v) || v.includes('/') || v.toLowerCase().includes(base)) return v;
  return `https://www.${base}/${v.replace(/^@/, '')}`;
}

/** https only (http upgraded), no credentials or port, then sorted into a kind or dropped. */
export function classify(value: string): SourceRef | null {
  let raw = value.trim();
  if (raw === '') return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.')) return null;
  url.hash = '';
  if (OPEN_DATA_HOSTS.some((h) => hostUnder(host, h))) return null;
  if (TOURIST_BOARD_HOSTS.some((h) => hostUnder(host, h))) {
    return { url: url.href, kind: 'tourist_board' };
  }
  if (SOCIAL_HOSTS.some((h) => hostUnder(host, h))) return { url: url.href, kind: 'social' };
  if (VENUE_HOST_DENYLIST.some((h) => hostUnder(host, h))) return null;
  return { url: url.href, kind: 'venue' };
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

function rowUrls(row: SourceRow): string[] {
  if (row.source === 'osm') {
    const tags = row.data.tags;
    if (!tags || typeof tags !== 'object') return [];
    const t = tags as Record<string, unknown>;
    const urls: string[] = [];
    for (const key of WEBSITE_TAGS) urls.push(...strings(t[key]).flatMap((v) => v.split(';')));
    for (const [key, base] of SOCIAL_TAGS) {
      urls.push(...strings(t[key]).flatMap((v) => v.split(';').map((h) => socialUrl(h, base))));
    }
    return urls;
  }
  if (row.source === 'overture') {
    return [...strings(row.data.websites), ...strings(row.data.socials)];
  }
  return [];
}

/** Deduplicated by href, venue first, then tourist board, then social, capped per task. */
function refsOf(urls: readonly string[]): SourceRef[] {
  const seen = new Set<string>();
  const refs: SourceRef[] = [];
  for (const value of urls) {
    const ref = classify(value);
    if (!ref || seen.has(ref.url)) continue;
    seen.add(ref.url);
    refs.push(ref);
  }
  return refs
    .map((ref, i) => ({ ref, i }))
    .sort((a, b) => KIND_ORDER[a.ref.kind] - KIND_ORDER[b.ref.kind] || a.i - b.i)
    .slice(0, DRAFTING_LIMITS.pagesPerTask)
    .map(({ ref }) => ref);
}

/** A candidate's allowed pages, from the venue URLs on its OSM and Overture rows. */
export function candidateSourceUrls(rows: readonly SourceRow[]): SourceRef[] {
  return refsOf(rows.flatMap(rowUrls));
}

/** A record's allowed pages: its website, every field source URL, and its rows' venue URLs. */
export function recordSourceUrls(
  record: { websiteUrl: string | null; fieldSources: Partial<Record<string, string>> },
  rows: readonly SourceRow[],
): SourceRef[] {
  return refsOf([
    ...(record.websiteUrl ? [record.websiteUrl] : []),
    ...Object.values(record.fieldSources).filter((v): v is string => typeof v === 'string'),
    ...rows.flatMap(rowUrls),
  ]);
}

/** The task's egress allowlist: each host plus its `www.` twin, so a bare-to-www redirect passes. */
export function allowlistFor(refs: readonly SourceRef[]): string[] {
  const hosts = new Set<string>();
  for (const ref of refs) {
    const host = new URL(ref.url).hostname.toLowerCase();
    const bare = host.replace(/^www\./, '');
    hosts.add(bare);
    hosts.add(`www.${bare}`);
  }
  return [...hosts];
}

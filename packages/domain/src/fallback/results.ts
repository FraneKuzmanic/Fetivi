import { stripMarkup } from '../property/sanitize';
import { FALLBACK_LIMITS, type FallbackSite, type FallbackSourceKind } from './vocabulary';

/** One hit as the search engine returned it: untrusted. */
export interface RawWebHit {
  title: string;
  url: string;
  description: string;
}

/** One hit that passed the re-check: an https page on a site the query named. */
export interface WebResult {
  title: string;
  snippet: string;
  url: string;
  source: { host: string; kind: FallbackSourceKind };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(
    /&#x([0-9a-f]{1,6});|&#(\d{1,7});|&([a-z]+);/gi,
    (match, hex?: string, dec?: string, name?: string) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
      const code = hex ? Number.parseInt(hex, 16) : Number(dec);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

/** Entities decoded, markup out, one line, cut to `max` with an ellipsis. */
function plainText(s: string, max: number): string {
  const plain = stripMarkup(decodeEntities(s), { singleLine: true }).replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

function siteOf(host: string, sites: readonly FallbackSite[]): FallbackSite | undefined {
  return sites.find((s) => host === s.host || host.endsWith(`.${s.host}`));
}

/**
 * Re-checks every hit against the sites the query named: https only (http upgraded), no
 * credentials or ports, the host one of `sites` or a subdomain of one. Everything else is dropped.
 */
export function filterHits(raw: readonly RawWebHit[], sites: readonly FallbackSite[]): WebResult[] {
  const seen = new Set<string>();
  const results: WebResult[] = [];
  for (const hit of raw) {
    let url: URL;
    try {
      url = new URL(hit.url);
    } catch {
      continue;
    }
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
    const host = url.hostname.toLowerCase();
    const site = siteOf(host, sites);
    if (!site || seen.has(url.href)) continue;
    const title = plainText(hit.title, FALLBACK_LIMITS.titleMaxChars);
    if (!title) continue;
    seen.add(url.href);
    results.push({
      title,
      snippet: plainText(hit.description, FALLBACK_LIMITS.snippetMaxChars),
      url: url.href,
      source: { host: host.replace(/^www\./, ''), kind: site.kind },
    });
    if (results.length === FALLBACK_LIMITS.results) break;
  }
  return results;
}

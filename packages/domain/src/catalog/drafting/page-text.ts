import { decodeEntities } from '../../fallback/results';
import { stripMarkup } from '../../property/sanitize';
import { DRAFTING_LIMITS, LINK_KEYWORDS } from './vocabulary';

// A fetched page reduced to length-limited plain text for the model (architecture §4.3
// "Untrusted content"). Markup stripping for model input, not sanitising for display: nothing here
// is rendered, and validate.ts checks every value again. Pure.

export interface PageLink {
  url: string;
  label: string;
}

export interface PageText {
  title: string;
  text: string;
  /** Up to three schema.org JSON-LD blocks, each cut to JSON_LD_MAX characters. */
  jsonLd: string[];
  /** Same-site pages worth following (contact, hours, menu …), best match first. */
  links: PageLink[];
}

const JSON_LD_MAX = 4000;
const JSON_LD_BLOCKS = 3;
const PAGE_TITLE_MAX = 300;

const JSON_LD =
  /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const META_DESCRIPTION = /<meta\b(?=[^>]*\bname\s*=\s*["']description["'])[^>]*>/i;
const CONTENT_ATTR = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
const DROPPED_ELEMENTS =
  /<(script|style|noscript|svg|template|iframe|head)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const BLOCK_TAG = /<\/?(?:p|div|li|h[1-6]|br|tr|section|article)\b[^>]*>/gi;

/** Entities decoded, markup out, whitespace collapsed (newlines kept unless `singleLine`). */
function plain(s: string, singleLine = false): string {
  const text = decodeEntities(stripMarkup(s, { singleLine }));
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join(singleLine ? ' ' : '\n');
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

function keywordRank(url: URL, label: string): number {
  const path = decodeURIComponent(url.pathname).toLowerCase();
  const text = label.toLowerCase();
  const i = LINK_KEYWORDS.findIndex((k) => path.includes(k) || text.includes(k));
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

function linksOf(html: string, pageUrl: string): PageLink[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const self = `${base.origin}${base.pathname}`;
  const found: { link: PageLink; rank: number; at: number }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(ANCHOR)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (href === '' || href.startsWith('#')) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || bareHost(url.hostname) !== bareHost(base.hostname)) continue;
    url.hash = '';
    if (`${url.origin}${url.pathname}` === self || seen.has(url.href)) continue;
    const label = plain(m[4] ?? '', true).slice(0, 100);
    const rank = keywordRank(url, label);
    if (!Number.isFinite(rank)) continue;
    seen.add(url.href);
    found.push({ link: { url: url.href, label }, rank, at: found.length });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, DRAFTING_LIMITS.linkedPagesPerSite)
    .map((f) => f.link);
}

export function pageText(html: string, pageUrl: string): PageText {
  const input = html.slice(0, DRAFTING_LIMITS.bytesPerPage);

  const jsonLd = [...input.matchAll(JSON_LD)]
    .map((m) => (m[1] ?? '').trim().slice(0, JSON_LD_MAX))
    .filter((block) => block !== '')
    .slice(0, JSON_LD_BLOCKS);
  const title = plain(TITLE.exec(input)?.[1] ?? '', true).slice(0, PAGE_TITLE_MAX);
  const meta = META_DESCRIPTION.exec(input)?.[0];
  const metaMatch = meta ? CONTENT_ATTR.exec(meta) : null;
  const description = plain(metaMatch?.[1] ?? metaMatch?.[2] ?? '', true);
  const links = linksOf(input, pageUrl);

  const body = input.replace(COMMENT, '').replace(DROPPED_ELEMENTS, '').replace(BLOCK_TAG, '\n');
  const text = [description, plain(body)]
    .filter((part) => part !== '')
    .join('\n')
    .slice(0, DRAFTING_LIMITS.charsPerPage);

  return { title, text, jsonLd, links };
}

import type { Egress } from '@fetivi/egress';
import { pageText } from './page-text';
import type { DraftingPage } from './prompt';
import type { SourceRef } from './sources';
import { DRAFTING_LIMITS } from './vocabulary';

// Reads a task's allowed pages through the task's own egress (its allowlist is exactly the refs'
// hosts, so a redirect off them is blocked). Never throws: a page that cannot be read counts as
// failed, and the task drafts from the rest.

export interface FetchedPages {
  pages: DraftingPage[];
  /** Blocked, unreachable, timed out or answered with an error status. */
  failed: number;
}

type Read = { kind: 'page'; url: string; html: string } | { kind: 'skipped' } | { kind: 'failed' };

/** The body as text, read as a stream and cancelled past `max` bytes. */
async function readCapped(response: Response, max: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - bytes;
    const chunk = value.byteLength > room ? value.subarray(0, room) : value;
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (bytes >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return text + decoder.decode();
}

async function read(fetch: Egress['fetch'], userAgent: string, url: string): Promise<Read> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': userAgent, accept: 'text/html' },
      signal: AbortSignal.timeout(DRAFTING_LIMITS.fetchTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { kind: 'failed' };
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/^text\/html\b/i.test(type)) {
      await response.body?.cancel().catch(() => {});
      return { kind: 'skipped' };
    }
    const html = await readCapped(response, DRAFTING_LIMITS.bytesPerPage);
    // The page actually read: the egress follows redirects hop by hop, so this is the last hop.
    return { kind: 'page', url: response.url || url, html };
  } catch {
    return { kind: 'failed' };
  }
}

export async function fetchPages(
  fetch: Egress['fetch'],
  userAgent: string,
  refs: readonly SourceRef[],
): Promise<FetchedPages> {
  const pages: DraftingPage[] = [];
  const seen = new Set<string>();
  let failed = 0;
  let chars = 0;
  const full = () =>
    pages.length >= DRAFTING_LIMITS.pagesPerTask || chars >= DRAFTING_LIMITS.charsPerTask;

  /** Reads one page; returns its same-site links worth following. */
  const visit = async (url: string) => {
    if (seen.has(url) || full()) return [];
    seen.add(url);
    const result = await read(fetch, userAgent, url);
    if (result.kind === 'failed') failed++;
    if (result.kind !== 'page' || (result.url !== url && seen.has(result.url))) return [];
    seen.add(result.url);
    const page = pageText(result.html, result.url);
    if (page.text.length < DRAFTING_LIMITS.minUsefulChars) return page.links;
    const room = DRAFTING_LIMITS.charsPerTask - chars;
    const text = page.text.slice(0, room);
    const jsonLd: string[] = [];
    let used = text.length;
    for (const block of page.jsonLd) {
      if (used + block.length > room) break;
      jsonLd.push(block);
      used += block.length;
    }
    chars += used;
    pages.push({ url: result.url, title: page.title, text, jsonLd });
    return page.links;
  };

  for (const ref of refs) {
    if (full()) break;
    const links = await visit(ref.url);
    if (ref.kind !== 'venue') continue;
    for (const link of links.slice(0, DRAFTING_LIMITS.linkedPagesPerSite)) await visit(link.url);
  }
  return { pages, failed };
}

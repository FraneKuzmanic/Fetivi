import type { MessagePart } from '../db/schema/conversations';

/** A piece of a cited answer: plain text, or a citation of a web result (0-based index). */
export type CitedSegment = { text: string } | { ref: number };

// `[n]` with one or two digits, with the space before it: the badge hugs its sentence.
const MARKER = /\s?\[(\d{1,2})\]/g;

/**
 * Splits `[n]` markers (1-based result order) off the text. A marker with no result is dropped;
 * any other bracket text stays as written. The same citation twice in a row shows once.
 */
export function parseCitations(text: string, count: number): CitedSegment[] {
  const segments: CitedSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const previous = segments.at(-1);
    if (previous && 'text' in previous) previous.text += value;
    else segments.push({ text: value });
  };
  let from = 0;
  for (const match of text.matchAll(MARKER)) {
    pushText(text.slice(from, match.index));
    from = match.index + match[0].length;
    const ref = Number(match[1]) - 1;
    if (ref < 0 || ref >= count) continue;
    const previous = segments.at(-1);
    if (previous && 'ref' in previous && previous.ref === ref) continue;
    segments.push({ ref });
  }
  pushText(text.slice(from));
  return segments;
}

/** Whether any marker in the text names one of the results. */
export const citesAny = (text: string, count: number) =>
  parseCitations(text, count).some((s) => 'ref' in s);

/** The text without its markers, for the spoken announcement. */
export const uncitedText = (text: string, count: number) =>
  parseCitations(text, count)
    .map((s) => ('text' in s ? s.text : ''))
    .join('');

/**
 * Plain text for a reader without badges: each marker becomes its site's host,
 * 'Open daily [1].' → 'Open daily (visittrogir.hr).'; a marker with no host goes.
 */
export const citationsAsHosts = (text: string, hosts: readonly string[]) =>
  parseCitations(text, hosts.length)
    .map((s) => ('text' in s ? s.text : ` (${(hosts[s.ref] ?? '').replace(/^www\./, '')})`))
    .join('')
    .trimStart();

/** The guest's streamed-card part type; mirrors `COMPONENT_PART_TYPE` in packages/ui payloads. */
const COMPONENT_PART_TYPE = 'data-component';

/** The hosts of a `web-results` card part, or null for any other part. */
function webResultHosts(part: MessagePart): string[] | null {
  if (part.type !== COMPONENT_PART_TYPE) return null;
  const data = part.data as { name?: unknown; payload?: { results?: unknown } } | undefined;
  if (data?.name !== 'web-results' || !Array.isArray(data.payload?.results)) return null;
  return data.payload.results.map((r: { source?: { host?: unknown } }) =>
    String(r?.source?.host ?? ''),
  );
}

/**
 * A message's text parts for a kept transcript, which drops the cards: text after a search reads
 * its markers as the cited hosts, as the guest saw badges there. Text before any search keeps its
 * brackets, as the guest saw it too.
 */
export function keptTextParts(parts: readonly MessagePart[]): MessagePart[] {
  const kept: MessagePart[] = [];
  let hosts: string[] | null = null;
  for (const part of parts) {
    hosts = webResultHosts(part) ?? hosts;
    if (part.type !== 'text') continue;
    kept.push(
      hosts && typeof part.text === 'string'
        ? { ...part, text: citationsAsHosts(part.text, hosts) }
        : part,
    );
  }
  return kept;
}

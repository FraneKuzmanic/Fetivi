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

/** A site's short name for its badge: 'www.visittrogir.hr' → 'visittrogir', 'split.gov.hr' → 'split'. */
export function siteName(host: string): string {
  const labels = host.replace(/^www\./, '').split('.');
  return labels[0] || host;
}

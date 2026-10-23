import { FallbackQueryError } from './errors';
import { FALLBACK_LIMITS, type FallbackSite } from './vocabulary';

// The web fallback query is an outbound payload shaped by the model (architecture §4.3 "Egress"):
// a constrained argument, topic keywords plus a place name, checked here before anything leaves
// the process. Shapes catch contact details and codes in general; the space's own private values
// catch what has no shape (a Wi-Fi password, a surname).

export interface FallbackQueryInput {
  keywords: string;
  place: string;
}

export interface FallbackQuery {
  topic: string;
  place: string;
}

/** NFKC, lower case, single spaces, trimmed. */
export function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const ALLOWED = /^[\p{L}\p{M}\p{N} '&.-]+$/u;
const OPERATOR_WORDS = new Set(['OR', 'AND', 'NOT']);
const DOMAIN_LIKE =
  /(^|[^\p{L}\p{N}-])[\p{L}\p{N}-]+\.(hr|com|net|org|eu|de|it|at|info|io)($|[^\p{L}\p{N}])/u;

const words = (s: string) => s.split(' ').filter(Boolean);
/** Spaces, dots and hyphens between digits do not break a run: `091 234 5678` is one run. */
const joinDigitRuns = (s: string) => s.replace(/(\d)[\s.-]+(?=\d)/g, '$1');
const digitsOnly = (s: string) => s.replace(/\D/g, '');

/**
 * A value matches anywhere, even inside a longer word, except a short one of plain letters (a
 * first name, an About me code like "food"): that matches as a whole word only, so the contact
 * name "Ana" does not block "banana boat".
 */
function containsValue(query: string, value: string): boolean {
  const short = value.length < 6 && /^[\p{L}\p{M} ]+$/u.test(value);
  if (!short) return query.includes(value);
  let from = query.indexOf(value);
  while (from !== -1) {
    const before = query[from - 1];
    const after = query[from + value.length];
    const letter = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{M}\p{N}]/u.test(ch);
    if (!letter(before) && !letter(after)) return true;
    from = query.indexOf(value, from + 1);
  }
  return false;
}

function checkShape(part: string) {
  if (!ALLOWED.test(part)) throw new FallbackQueryError('shape');
  if (/\bsite:/i.test(part)) throw new FallbackQueryError('shape');
  for (const word of part.split(' ')) {
    if (OPERATOR_WORDS.has(word) || word.startsWith('-')) throw new FallbackQueryError('shape');
  }
}

function checkLength(part: string, maxChars: number, maxWords: number) {
  if (part.length < FALLBACK_LIMITS.minChars || part.length > maxChars) {
    throw new FallbackQueryError('length');
  }
  if (words(part).length > maxWords) throw new FallbackQueryError('length');
}

/**
 * Validates and normalizes a web fallback query, or throws `FallbackQueryError`. `privateValues`
 * are the space's values (normalized, 3+ chars) the query must never carry.
 */
export function checkFallbackQuery(
  input: FallbackQueryInput,
  privateValues: readonly string[],
): FallbackQuery {
  const keywords = input.keywords.trim();
  const place = input.place.trim();
  checkShape(keywords);
  checkShape(place);
  checkLength(keywords, FALLBACK_LIMITS.keywordsMaxChars, FALLBACK_LIMITS.keywordsMaxWords);
  checkLength(place, FALLBACK_LIMITS.placeMaxChars, FALLBACK_LIMITS.placeMaxWords);

  const topic = normalize(keywords);
  const where = normalize(place);
  const query = `${topic} ${where}`;
  if (query.includes('www.') || DOMAIN_LIKE.test(query)) throw new FallbackQueryError('contact');

  const runs = joinDigitRuns(query).match(/\d+/g) ?? [];
  if (runs.some((run) => run.length > FALLBACK_LIMITS.maxDigitRun)) {
    throw new FallbackQueryError('digits');
  }

  const queryDigits = digitsOnly(query);
  for (const value of privateValues) {
    if (value.length < 3) continue;
    if (containsValue(query, value)) throw new FallbackQueryError('private');
    const valueDigits = digitsOnly(value);
    if (valueDigits.length >= 3 && queryDigits.includes(valueDigits)) {
      throw new FallbackQueryError('private');
    }
  }
  return { topic, place: where };
}

export interface BraveQuery {
  q: string;
  /** The sites that fit the budget; the re-check uses only these. */
  sites: FallbackSite[];
}

/** `topic place (site:a OR site:b …)`, adding sites in order while Brave's limits allow. */
export function buildBraveQuery(
  topic: string,
  place: string,
  sites: readonly FallbackSite[],
): BraveQuery {
  const head = `${topic} ${place}`;
  const compose = (hosts: readonly FallbackSite[]) =>
    `${head} (${hosts.map((s) => `site:${s.host}`).join(' OR ')})`;
  const used: FallbackSite[] = [];
  for (const site of sites) {
    const q = compose([...used, site]);
    if (q.length > FALLBACK_LIMITS.braveMaxChars) break;
    if (words(q).length > FALLBACK_LIMITS.braveMaxWords) break;
    used.push(site);
  }
  return { q: compose(used), sites: used };
}

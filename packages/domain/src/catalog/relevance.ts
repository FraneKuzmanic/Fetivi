import { type AboutMeFit, type RankCandidate, rankPlaces } from './ranking';

// How well a catalog record answers a guest's search: semantic similarity of embeddings first,
// boosted by a named place or matching words, with a word-by-word fallback when a vector or the
// embedder is missing. Pure: search loads the vectors and texts, this module only scores.

/**
 * Tuned on the labelled fixture set (`relevance-fixtures.test.ts`, voyage-4): unrelated text
 * scores up to ~0.13 there, the weakest wanted hit ~0.24 ("family kids": a beach). The set
 * passes with `relative` up to 0.65.
 */
export const RELEVANCE = {
  /** A record scoring at least this matches the query. */
  cutoff: 0.2,
  /**
   * A place also needs this share of the best score in the search, so a named place sets the bar
   * and its weak neighbours drop ("Krka National Park" lifts every cosine to ~0.4–0.5).
   */
  relative: 0.6,
  /** Records within one band of relevance rank by the usual rules (About me, quality, distance). */
  band: 0.05,
  /** Added when the query names the record. */
  nameBoost: 0.3,
  /** Times the share of query words found in the record's text. */
  wordBoost: 0.1,
  /** Times the record's similarity to `avoid`, taken off its order (never off whether it matches). */
  avoidWeight: 1,
  /** Where a record without a vector starts when any query word matches its text: the cutoff. */
  lexicalBase: 0.2,
} as const;

/** Lowercase, diacritics stripped ("Čiovo" → "ciovo"). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function words(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Filler words of the seven guest languages that say nothing about a place. */
const STOP_WORDS = new Set(
  [
    // en
    'the and for with something some near good nice place',
    // hr
    'i u na za s sa ili nešto neki dobar',
    // de
    'der die das und für mit etwas ein eine',
    // it
    'il la per con qualcosa una uno',
    // pl
    'i w na dla z coś',
    // hu
    'a az és egy valami',
    // fr
    'le la les et pour avec quelque chose un une',
  ].flatMap(words),
);

/** The words of a search that carry meaning: 3+ letters (any number), no stop words. */
export function searchWords(text: string): string[] {
  return words(text).filter((w) => (w.length >= 3 || /^\p{N}+$/u.test(w)) && !STOP_WORDS.has(w));
}

/** Equal, or one a prefix of the other with the shorter at least 4 characters. */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** Share (0–1) of the query's search words found in any of the texts; 0 without search words. */
export function lexicalScore(query: string, texts: string[]): number {
  const wanted = searchWords(query);
  if (wanted.length === 0) return 0;
  const have = new Set(texts.flatMap(words));
  const found = wanted.filter((w) => {
    if (have.has(w)) return true;
    for (const h of have) if (wordsMatch(w, h)) return true;
    return false;
  });
  return found.length / wanted.length;
}

/** Words joined by single spaces and padded, so containment is whole words only. */
const phrase = (text: string) => ` ${words(text).join(' ')} `;

/** The query names a title ("Kamerlengo" → "Kamerlengo Fortress", "bus 37" → "… city bus 37"). */
export function nameMatch(query: string, titles: string[]): boolean {
  const q = phrase(query);
  if (q.trim().length === 0) return false;
  return titles.some((title) => {
    const t = phrase(title);
    if (t.trim().length === 0) return false;
    return q.includes(t) || (q.trim().length >= 4 && t.includes(q));
  });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const bestCosine = (q: number[], vectors: number[][]) =>
  vectors.reduce((best, v) => Math.max(best, cosine(q, v)), Number.NEGATIVE_INFINITY);

export interface RelevanceInput {
  /** Null when the embedder could not answer: the record is scored on words only. */
  queryVector: number[] | null;
  avoidVector: number[] | null;
  query: string;
  avoid: string | null;
  /** The record's vectors of the current model, one per translation; empty when not embedded yet. */
  vectors: number[][];
  titles: string[];
  /** Every title and body of the record's published translations. */
  texts: string[];
}

export interface Relevance {
  score: number;
  /** The score reaches the cutoff; decided before `avoid`, so an avoided record is demoted, not hidden. */
  matches: boolean;
  /** The score less the `avoid` penalty: what results sort by. */
  order: number;
  /** Scored on vectors; false when on words only (no vector yet, or no query vector). */
  semantic: boolean;
}

export function relevanceOf(i: RelevanceInput): Relevance {
  const r = RELEVANCE;
  const lexical = lexicalScore(i.query, i.texts);
  const named = nameMatch(i.query, i.titles);
  const boost = r.wordBoost * lexical + (named ? r.nameBoost : 0);
  const semantic = i.queryVector !== null && i.vectors.length > 0;

  const score = semantic
    ? bestCosine(i.queryVector as number[], i.vectors) + boost
    : lexical > 0 || named
      ? r.lexicalBase + boost
      : 0;

  let penalty = 0;
  if (i.avoid) {
    penalty =
      semantic && i.avoidVector !== null
        ? r.avoidWeight * Math.max(0, bestCosine(i.avoidVector, i.vectors))
        : r.avoidWeight * lexicalScore(i.avoid, i.texts);
  }
  return { score, matches: score >= r.cutoff, order: score - penalty, semantic };
}

/**
 * Whether a record matches, given every candidate of the search: it reaches the cutoff and
 * `relative` of the best score (including candidates dropped only for the season). Vector and
 * word-only scores are on different scales, so each is measured against the best of its own kind:
 * a record without a vector yet is never hidden by a well-embedded neighbour.
 */
export function matcherFor(all: Relevance[]): (r: Relevance) => boolean {
  const bestOf = (semantic: boolean) =>
    all.reduce((max, r) => (r.semantic === semantic ? Math.max(max, r.score) : max), 0);
  const best = { semantic: bestOf(true), words: bestOf(false) };
  return (r) =>
    r.matches && r.score >= RELEVANCE.relative * (r.semantic ? best.semantic : best.words);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Relevance bands first (best band first), then the usual ranking inside a band, with the
 * relevance as the text score so fit still weighs. `relevance` is a record's `order`.
 */
export function rankByRelevance<T extends RankCandidate & { relevance: number }>(
  candidates: T[],
  aboutMe: AboutMeFit | null,
): T[] {
  const ranked = rankPlaces(
    candidates.map((c) => ({ ...c, textScore: clamp01(c.relevance), original: c })),
    aboutMe,
  );
  const position = new Map(ranked.map((c, i) => [c.original, i]));
  // The epsilon keeps 0.45 / 0.05 from landing just under 9 in floating point.
  const band = (c: T) => Math.floor(c.relevance / RELEVANCE.band + 1e-9);
  return [...candidates].sort(
    (a, b) => band(b) - band(a) || (position.get(a) ?? 0) - (position.get(b) ?? 0),
  );
}

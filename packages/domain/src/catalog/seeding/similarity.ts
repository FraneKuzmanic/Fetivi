import { GENERIC_NAME_WORDS } from './vocabulary';

const fold = (name: string): string[] =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đðĐÐ]/g, 'd')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((t) => t !== '');

/**
 * Diacritics folded, lowercased, punctuation removed and generic words ("plaža", "konoba",
 * "caffe bar") dropped. A name made only of generic words keeps them, so it is never empty.
 */
export function normaliseName(name: string): string {
  const tokens = fold(name);
  const specific = tokens.filter((t) => !GENERIC_NAME_WORDS.has(t));
  return (specific.length > 0 ? specific : tokens).join(' ');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/**
 * 0..1 on the normalised names: 1 when equal, 0.9 when one's tokens are a subset of the other's,
 * otherwise the Dice coefficient of their character bigrams (spaces removed).
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if ([...small].every((t) => large.has(t))) return 0.9;
  return dice(na.replace(/ /g, ''), nb.replace(/ /g, ''));
}

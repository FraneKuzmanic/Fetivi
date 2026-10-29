import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matcherFor, RELEVANCE, type Relevance, relevanceOf } from './relevance';
import { type FixtureRecord, RELEVANCE_CASES, type RelevanceCase } from './relevance-fixtures';

// AC4 (61): the labelled guest queries against the dev DB's Trogir catalog, on Voyage vectors
// recorded by relevance-record-cli.ts. No live calls: this pins RELEVANCE.

interface Recorded {
  model: string;
  documents: (FixtureRecord & { language: string; title: string; body: string; vector: string })[];
  queries: Record<string, string>;
}

const recorded = JSON.parse(
  readFileSync(new URL('./recorded/relevance-trogir.json', import.meta.url), 'utf8'),
) as Recorded;

const decode = (b64: string): number[] => {
  const bytes = Buffer.from(b64, 'base64');
  return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
};

/** One entry per record, its translations' titles, texts and vectors together, as search loads them. */
const records = [
  ...recorded.documents
    .reduce((map, d) => {
      const r = map.get(d.id) ?? {
        record: {
          id: d.id,
          name: d.name,
          kind: d.kind,
          category: d.category,
          rainyDay: d.rainyDay,
        },
        titles: [] as string[],
        texts: [] as string[],
        vectors: [] as number[][],
      };
      r.titles.push(d.title);
      r.texts.push(d.title, d.body);
      r.vectors.push(decode(d.vector));
      return map.set(d.id, r);
    }, new Map<
      string,
      { record: FixtureRecord; titles: string[]; texts: string[]; vectors: number[][] }
    >())
    .values(),
];

const vectorOf = (text: string) => {
  const v = recorded.queries[text];
  if (!v) throw new Error(`no recorded vector for "${text}": rerun the recorder`);
  return decode(v);
};

const PLACE_KINDS = new Set(['place', 'day_trip', 'host_added']);

/** Every candidate with its relevance and whether it matches, best first. */
function search(c: RelevanceCase) {
  const candidates = records
    .filter((r) => c.among === 'all' || PLACE_KINDS.has(r.record.kind))
    .filter((r) => !c.rainyDay || r.record.rainyDay);
  const { query } = c;
  if (query === undefined) {
    return candidates.map((r) => ({ record: r.record, score: 0, order: 0, matches: true }));
  }
  const queryVector = vectorOf(query);
  const avoidVector = c.avoid ? vectorOf(c.avoid) : null;
  const scored = candidates.map((r) => ({
    record: r.record,
    ...relevanceOf({
      queryVector,
      avoidVector,
      query,
      avoid: c.avoid ?? null,
      vectors: r.vectors,
      titles: r.titles,
      texts: r.texts,
    }),
  }));
  // As search does: places also need a share of the best score; events and notes the cutoff only.
  const matches = c.among === 'all' ? (r: Relevance) => r.matches : matcherFor(scored);
  return scored.map((r) => ({ ...r, matches: matches(r) })).sort((a, b) => b.order - a.order);
}

describe('labelled guest queries (AC4)', () => {
  it('were recorded with the production model', () => {
    expect(recorded.model).toBe('voyage-4');
    expect(records.length).toBeGreaterThanOrEqual(19);
  });

  for (const c of RELEVANCE_CASES) {
    const label = `${c.query ?? '(no query)'}${c.rainyDay ? ' on a rainy day' : ''}`;
    it(`${label}${c.avoid ? ` (avoid ${c.avoid})` : ''}`, () => {
      const all = search(c);
      const matched = all.filter((r) => r.matches).map((r) => r.record);
      const names = matched.map((r) => r.name);
      for (const e of c.expect) {
        if ('none' in e) expect(names).toEqual([]);
        else if ('first' in e) expect(names[0]).toBe(e.first);
        else if ('notFirst' in e) {
          expect(names).toContain(e.notFirst);
          expect(names[0]).not.toBe(e.notFirst);
        } else if ('includes' in e) expect(names.slice(0, e.top)).toContain(e.includes);
        else if ('every' in e) {
          const top = matched.slice(0, e.top);
          expect(top.length, e.label).toBeGreaterThan(0);
          expect(top.every(e.every), `${e.label}: ${names.slice(0, e.top).join(', ')}`).toBe(true);
        } else {
          const top = matched.slice(0, e.top);
          expect(top.some(e.some), `${e.label}: ${names.slice(0, e.top).join(', ')}`).toBe(true);
        }
      }
    });
  }

  it('leaves a margin between the nonsense query and the weakest expected hit', () => {
    const nonsense = search({ query: 'xqzt vlorp', expect: [] });
    const nonsenseMax = Math.max(...nonsense.map((r) => r.score));
    const hits = RELEVANCE_CASES.flatMap((c) =>
      c.expect.flatMap((e) => {
        const name = 'first' in e ? e.first : 'includes' in e ? e.includes : null;
        const hit = name ? search(c).find((r) => r.record.name === name) : undefined;
        return hit ? [hit.score] : [];
      }),
    );
    const weakestHit = Math.min(...hits);
    expect(nonsenseMax).toBeLessThan(RELEVANCE.cutoff);
    expect(weakestHit).toBeGreaterThanOrEqual(RELEVANCE.cutoff);
  });
});

import { describe, expect, it } from 'vitest';
import type { RankCandidate } from './ranking';
import {
  cosine,
  lexicalScore,
  matcherFor,
  nameMatch,
  RELEVANCE,
  type RelevanceInput,
  rankByRelevance,
  relevanceOf,
  searchWords,
} from './relevance';

describe('searchWords', () => {
  it('drops stop words and short words, keeps numbers', () => {
    expect(searchWords('Something nice for the kids, near the sea')).toEqual(['kids', 'sea']);
    expect(searchWords('bus 37')).toEqual(['bus', '37']);
    expect(searchWords('etwas für Kinder')).toEqual(['kinder']);
    expect(searchWords('nešto za djecu')).toEqual(['djecu']);
  });

  it('strips diacritics', () => {
    expect(searchWords('Čiovo')).toEqual(['ciovo']);
  });
});

describe('lexicalScore', () => {
  it('matches equal words regardless of case and diacritics', () => {
    expect(lexicalScore('ciovo', ['Bridge to Čiovo'])).toBe(1);
  });

  it('matches a prefix of 4+ characters either way', () => {
    expect(lexicalScore('fish', ['Fishing trips'])).toBe(1);
    expect(lexicalScore('wetlands', ['A small wetland'])).toBe(1);
    expect(lexicalScore('wetland', ['Coastal wetlands'])).toBe(1);
  });

  it('needs the shorter word to have 4 characters for a prefix', () => {
    expect(lexicalScore('sea', ['Seafood platter'])).toBe(0);
    expect(lexicalScore('seafood', ['By the sea'])).toBe(0);
  });

  it('scores the share of query words found', () => {
    expect(lexicalScore('fresh fish seafood', ['Grilled fish and black risotto'])).toBeCloseTo(
      1 / 3,
    );
    expect(lexicalScore('grilled fish', ['Grilled fish and black risotto'])).toBe(1);
    expect(lexicalScore('the and', ['the and'])).toBe(0);
    expect(lexicalScore('xyzzy', ['Kamerlengo Fortress'])).toBe(0);
  });
});

describe('nameMatch', () => {
  it('finds a title in the query and the query in a title', () => {
    expect(nameMatch('Kamerlengo', ['Kamerlengo Fortress'])).toBe(true);
    expect(nameMatch('dinner at Konoba Mala tonight', ['Konoba Mala'])).toBe(true);
    expect(nameMatch('bus 37', ['Split–Trogir city bus 37'])).toBe(true);
    expect(nameMatch('konoba mala', ['Konoba Mala'])).toBe(true);
  });

  it('matches whole words only and ignores empty titles', () => {
    expect(nameMatch('fort', ['Kamerlengo Fortress'])).toBe(false);
    expect(nameMatch('fish', ['Fishing trips'])).toBe(false);
    expect(nameMatch('fish', [''])).toBe(false);
  });
});

describe('cosine', () => {
  it('is 1 for the same direction and 0 for orthogonal or zero vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

const input = (over: Partial<RelevanceInput>): RelevanceInput => ({
  queryVector: null,
  avoidVector: null,
  query: '',
  avoid: null,
  vectors: [],
  titles: [],
  texts: [],
  ...over,
});

describe('relevanceOf', () => {
  it('takes the best translation on the semantic path, boosted by words', () => {
    const r = relevanceOf(
      input({
        queryVector: [1, 0],
        query: 'fish',
        vectors: [
          [0, 1],
          [1, 1],
        ],
        titles: ['Konoba Mala'],
        texts: ['Konoba Mala', 'Grilled fish'],
      }),
    );
    expect(r.score).toBeCloseTo(Math.SQRT1_2 + RELEVANCE.wordBoost);
    expect(r.matches).toBe(true);
  });

  it('boosts a named record', () => {
    const plain = relevanceOf(input({ queryVector: [1, 0], query: 'konoba', vectors: [[1, 1]] }));
    const named = relevanceOf(
      input({
        queryVector: [1, 0],
        query: 'konoba mala',
        vectors: [[1, 1]],
        titles: ['Konoba Mala'],
      }),
    );
    expect(named.score - plain.score).toBeCloseTo(RELEVANCE.nameBoost);
  });

  it('falls back to words without a query vector or without record vectors', () => {
    const texts = ['Kamerlengo Fortress', 'A Venetian fortress'];
    const noQueryVector = relevanceOf(input({ query: 'fortress', texts }));
    expect(noQueryVector).toMatchObject({ matches: true, semantic: false });
    expect(noQueryVector.score).toBeCloseTo(RELEVANCE.lexicalBase + RELEVANCE.wordBoost);
    expect(relevanceOf(input({ queryVector: [1, 0], query: 'fortress', texts })).matches).toBe(
      true,
    );
    expect(relevanceOf(input({ query: 'xyzzy', texts }))).toEqual({
      score: 0,
      matches: false,
      order: 0,
      semantic: false,
    });
  });

  it('ranks more matched words higher on the fallback', () => {
    const texts = ['Grilled fish and black risotto'];
    const one = relevanceOf(input({ query: 'fish pizza', texts }));
    const two = relevanceOf(input({ query: 'grilled fish', texts }));
    expect(two.score).toBeGreaterThan(one.score);
  });

  it('demotes on avoid without hiding', () => {
    const base = input({ queryVector: [1, 0], query: 'dinner', vectors: [[1, 0.2]] });
    const plain = relevanceOf(base);
    const avoided = relevanceOf({ ...base, avoid: 'fish', avoidVector: [1, 0.2] });
    expect(avoided.matches).toBe(true);
    expect(avoided.score).toBe(plain.score);
    expect(avoided.order).toBeCloseTo(plain.order - RELEVANCE.avoidWeight);

    const lexical = relevanceOf(
      input({ query: 'dinner', avoid: 'fish', texts: ['Fish dinner by the sea'] }),
    );
    expect(lexical.matches).toBe(true);
    expect(lexical.order).toBeCloseTo(lexical.score - RELEVANCE.avoidWeight);
  });
});

describe('rankByRelevance', () => {
  const candidate = (
    over: Partial<RankCandidate> & { id: string; relevance: number },
  ): RankCandidate & { relevance: number } => ({
    category: 'sight',
    textScore: null,
    staleness: 'fresh',
    distanceM: 1000,
    ...over,
  });
  const ids = (list: { id: string }[]) => list.map((c) => c.id);
  const aboutMe = { categoryWeights: { beach: 1 } };

  it('keeps a better band above an About me favourite', () => {
    const list = [
      candidate({ id: 'beach', category: 'beach', relevance: 0.5 }),
      candidate({ id: 'sight', category: 'sight', relevance: 0.7 }),
    ];
    expect(ids(rankByRelevance(list, aboutMe))).toEqual(['sight', 'beach']);
  });

  it('lets About me decide inside a band', () => {
    const list = [
      candidate({ id: 'sight', category: 'sight', relevance: 0.71 }),
      candidate({ id: 'beach', category: 'beach', relevance: 0.7 }),
    ];
    expect(ids(rankByRelevance(list, aboutMe))).toEqual(['beach', 'sight']);
    expect(ids(rankByRelevance(list, null))).toEqual(['sight', 'beach']);
  });
});

describe('matcherFor', () => {
  const r = (score: number, semantic = true) => ({
    score,
    matches: score >= RELEVANCE.cutoff,
    order: score,
    semantic,
  });

  it('drops matches far below the best one', () => {
    const named = r(0.9);
    const neighbour = r(0.5);
    const matches = matcherFor([named, neighbour, r(0.1)]);
    expect(matches(named)).toBe(true);
    expect(matches(neighbour)).toBe(false);
  });

  it('keeps every match that reaches the cutoff when scores are close', () => {
    const weak = r(RELEVANCE.cutoff);
    const matches = matcherFor([r(0.26), weak, r(0.1)]);
    expect(matches(weak)).toBe(true);
    expect(matches(r(0.1))).toBe(false);
  });

  it('never hides a record without a vector behind a well-embedded one', () => {
    // A word-only record tops out at lexicalBase + wordBoost: 0.3, under 0.6 of a 0.52 cosine.
    const wordsOnly = r(RELEVANCE.lexicalBase + RELEVANCE.wordBoost, false);
    const matches = matcherFor([r(0.52), wordsOnly]);
    expect(matches(wordsOnly)).toBe(true);
  });

  it('still drops word-only matches far below a named word-only match', () => {
    const named = r(RELEVANCE.lexicalBase + RELEVANCE.nameBoost + RELEVANCE.wordBoost, false);
    const weak = r(RELEVANCE.lexicalBase, false);
    const matches = matcherFor([named, weak]);
    expect(matches(named)).toBe(true);
    expect(matches(weak)).toBe(false);
  });
});

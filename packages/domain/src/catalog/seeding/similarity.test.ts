import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nameSimilarity, normaliseName } from './similarity';

describe('normaliseName', () => {
  it('folds diacritics and drops generic words', () => {
    expect(normaliseName('Plaža Saldun')).toBe('saldun');
    expect(normaliseName('Caffe bar Đir')).toBe('dir');
  });

  it('keeps a name made only of generic words', () => {
    expect(normaliseName('Beach Bar')).toBe('beach bar');
  });
});

describe('nameSimilarity', () => {
  it('matches names that differ only by generic words or diacritics', () => {
    expect(nameSimilarity('Plaža Saldun', 'Saldun')).toBe(1);
    expect(nameSimilarity('Konoba Trs', 'Restaurant Trs')).toBe(1);
    expect(nameSimilarity('Caffe bar Đir', 'Cafe Dir')).toBe(1);
  });

  it('scores a token subset at 0.9', () => {
    expect(nameSimilarity('Kamerlengo', 'Kamerlengo Fortress')).toBe(0.9);
  });

  it('leaves a translated name for review', () => {
    const score = nameSimilarity('Kamerlengo Fortress', 'Tvrđava Kamerlengo');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.85);
  });

  it('scores different places low', () => {
    expect(nameSimilarity('Saldun', 'Okrug Gornji')).toBeLessThan(0.3);
  });

  it('is symmetric and within 0..1', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const s = nameSimilarity(a, b);
        expect(s).toBe(nameSimilarity(b, a));
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }),
    );
  });
});

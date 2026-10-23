import { describe, expect, it } from 'vitest';
import { FallbackQueryError, type FallbackQueryReason } from './errors';
import { buildBraveQuery, checkFallbackQuery, type PrivateValues } from './query';
import { FALLBACK_LIMITS, FALLBACK_SITES, type FallbackSite } from './vocabulary';

const NONE: PrivateValues = { secrets: [], words: [] };

function reasonOf(keywords: string, place = 'Trogir', values: Partial<PrivateValues> = {}) {
  try {
    checkFallbackQuery({ keywords, place }, { ...NONE, ...values });
  } catch (error) {
    if (error instanceof FallbackQueryError) return error.reason;
    throw error;
  }
  return null;
}

describe('checkFallbackQuery', () => {
  it('accepts topic keywords and a place, normalized', () => {
    expect(checkFallbackQuery({ keywords: ' Kayak   Rental ', place: 'Trogir' }, NONE)).toEqual({
      topic: 'kayak rental',
      place: 'trogir',
    });
  });

  it('accepts a short number', () => {
    expect(reasonOf('bus 37')).toBeNull();
  });

  it.each<[string, FallbackQueryReason]>([
    ['pin 4821', 'digits'],
    ['door 12-34', 'digits'],
    ['call 091 234 5678', 'digits'],
    ['code 12.34', 'digits'],
    ['pin ٤٨٢١', 'shape'],
    ['pin ４８２１', 'shape'],
    ['a@b.hr', 'shape'],
    ['visittrogir.hr', 'contact'],
    ['www.example', 'contact'],
    ['site:evil.com', 'shape'],
    ['beach OR', 'shape'],
    ['beach -nudist', 'shape'],
    ['ferry\ntimes', 'shape'],
    ['', 'shape'],
    ['x', 'length'],
    ['a'.repeat(61), 'length'],
    ['one two three four five six seven eight nine', 'length'],
  ])('rejects %j (%s)', (keywords, reason) => {
    expect(reasonOf(keywords)).toBe(reason);
  });

  it('rejects a place that breaks the contract', () => {
    expect(reasonOf('kayak', 'Trogir 21220')).toBe('digits');
    expect(reasonOf('kayak', 'one two three four five')).toBe('length');
  });

  it('rejects a private value case-insensitively, also inside a longer word', () => {
    expect(reasonOf('W-AB12-4', 'Trogir', { secrets: ['w-ab12-4'] })).toBe('private');
    expect(reasonOf('xw-ab12-4x', 'Trogir', { secrets: ['w-ab12-4'] })).toBe('private');
  });

  it('rejects a short plain-letter secret inside a longer word', () => {
    expect(reasonOf('sunnybeach bar', 'Trogir', { secrets: ['sunny'] })).toBe('private');
  });

  it("rejects a private value's digits however they are spaced", () => {
    expect(reasonOf('bus 1 2 3', 'Trogir', { secrets: ['door 123'] })).toBe('private');
  });

  it('rejects a booker name word inside the query', () => {
    expect(reasonOf('horvat family beach', 'Trogir', { words: ['horvat'] })).toBe('private');
  });

  it('matches a short plain-letter value as a whole word only', () => {
    expect(reasonOf('banana boat', 'Trogir', { words: ['ana'] })).toBeNull();
    expect(reasonOf('seafood', 'Trogir', { words: ['food'] })).toBeNull();
    expect(reasonOf('ana tours', 'Trogir', { words: ['ana'] })).toBe('private');
    expect(reasonOf('sunnydaybar', 'Trogir', { words: ['sunnyday'] })).toBe('private');
  });

  it('rejects saved About me values in word and code form', () => {
    const values = { words: ['gluten_free', 'gluten free'] };
    expect(reasonOf('gluten free bakery', 'Trogir', values)).toBe('private');
    expect(reasonOf('gluten_free', 'Trogir', values)).toBe('shape');
    expect(reasonOf('bakery', 'Trogir', values)).toBeNull();
  });
});

describe('buildBraveQuery', () => {
  it('adds the sites as site: operators', () => {
    const { q, sites } = buildBraveQuery('kayak rental', 'trogir', FALLBACK_SITES.slice(0, 2));
    expect(q).toBe('kayak rental trogir (site:croatia.hr OR site:dalmatia.hr)');
    expect(sites).toHaveLength(2);
  });

  it("stays within Brave's limits with many venue hosts, static sites first", () => {
    const venues: FallbackSite[] = Array.from({ length: 60 }, (_, i) => ({
      host: `venue-number-${i}.hr`,
      kind: 'venue',
    }));
    const topic = 'a'.repeat(60);
    const { q, sites } = buildBraveQuery(topic, 'b'.repeat(40), [...FALLBACK_SITES, ...venues]);
    expect(q.length).toBeLessThanOrEqual(FALLBACK_LIMITS.braveMaxChars);
    expect(q.split(' ').length).toBeLessThanOrEqual(FALLBACK_LIMITS.braveMaxWords);
    expect(sites.slice(0, FALLBACK_SITES.length)).toEqual(FALLBACK_SITES);
    expect(sites.length).toBeLessThan(FALLBACK_SITES.length + venues.length);
  });

  it('keeps to the word limit with short hosts', () => {
    const venues: FallbackSite[] = Array.from({ length: 60 }, (_, i) => ({
      host: `v${i}.hr`,
      kind: 'venue',
    }));
    const { q } = buildBraveQuery('kayak', 'trogir', venues);
    expect(q.split(' ').length).toBeLessThanOrEqual(FALLBACK_LIMITS.braveMaxWords);
  });
});

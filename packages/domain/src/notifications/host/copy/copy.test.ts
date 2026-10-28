import { describe, expect, it } from 'vitest';
import { HANDOFF_REASONS } from '../../../handoff/vocabulary';
import { PRICE_UNITS } from '../../../offers/vocabulary';
import { BACKOFFICE_LANGUAGES } from '../../../property/vocabulary';
import { pluralHr } from './hr';
import { HOST_COPY } from './index';

/** Every leaf as a dotted path, with its kind: a string, or a function and its arity. */
function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [`${path}:string`];
  if (typeof value === 'function') return [`${path}:fn${value.length}`];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, v]) => shape(v, path ? `${path}.${key}` : key))
    .sort();
}

/** Every text the copy can produce, calling each function with sample arguments. */
function texts(value: unknown, n: number): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    const args = Array.from({ length: value.length }, (_, i) => (i === 0 ? n : `x${i}`));
    // Count functions take a number; the others take strings and get the number as text.
    return [String((value as (...a: unknown[]) => unknown)(...args))];
  }
  return Object.values(value as Record<string, unknown>).flatMap((v) => texts(v, n));
}

describe('host copy', () => {
  it('has the same keys and argument counts in every language', () => {
    const en = shape(HOST_COPY.en);
    for (const language of BACKOFFICE_LANGUAGES) expect(shape(HOST_COPY[language])).toEqual(en);
  });

  it('names every reason and price unit', () => {
    for (const language of BACKOFFICE_LANGUAGES) {
      const copy = HOST_COPY[language];
      expect(Object.keys(copy.reasons).sort()).toEqual([...HANDOFF_REASONS].sort());
      expect(Object.keys(copy.order.quantity).sort()).toEqual([...PRICE_UNITS].sort());
    }
  });

  it('never produces empty text', () => {
    for (const language of BACKOFFICE_LANGUAGES) {
      for (const n of [1, 2, 5, 21]) {
        for (const text of texts(HOST_COPY[language], n)) expect(text.trim()).not.toBe('');
      }
    }
  });

  it('picks the Croatian one, few and other forms', () => {
    const form = (n: number) => pluralHr(n, 'one', 'few', 'other');
    for (const n of [1, 21, 101]) expect(form(n)).toBe('one');
    for (const n of [2, 3, 4, 22]) expect(form(n)).toBe('few');
    for (const n of [5, 11, 12, 14, 25]) expect(form(n)).toBe('other');
    expect(HOST_COPY.hr.digest.count(22)).toBe('22 nove poruke gosta');
    expect(HOST_COPY.hr.digest.count(11)).toBe('11 novih poruka gosta');
    expect(HOST_COPY.hr.digest.waiting(21)).toBe('Čeka vas 21 poruka gosta:');
    expect(HOST_COPY.en.digest.count(1)).toBe('1 new guest message');
  });
});

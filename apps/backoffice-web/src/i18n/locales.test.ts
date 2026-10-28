import { describe, expect, it } from 'vitest';
import { locales } from './index';

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Nested messages → dotted key → string. */
function flatten(value: unknown, prefix = '', out = new Map<string, string>()) {
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(path, child);
    else flatten(child, path, out);
  }
  return out;
}

/** Base key → the plural forms it has ('' for a plain key). */
function bases(messages: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of messages.keys()) {
    const match = key.match(PLURAL);
    const base = match ? key.slice(0, -match[0].length) : key;
    out.set(base, [...(out.get(base) ?? []), match?.[1] ?? '']);
  }
  return out;
}

const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();

describe('locales', () => {
  const en = flatten(locales.en);
  const hr = flatten(locales.hr);
  const enBases = bases(en);
  const hrBases = bases(hr);

  it('have the same keys in en and hr', () => {
    expect([...hrBases.keys()].sort()).toEqual([...enBases.keys()].sort());
  });

  it('give en one/other and hr one/few/other for every plural', () => {
    const hrForms = new Intl.PluralRules('hr').resolvedOptions().pluralCategories.slice().sort();
    for (const [base, forms] of enBases) {
      if (forms[0] === '') continue;
      expect(forms.slice().sort(), base).toEqual(['one', 'other']);
      expect((hrBases.get(base) ?? []).slice().sort(), base).toEqual(hrForms);
    }
  });

  it('keep the placeholders of each key in every form, with none empty', () => {
    for (const [code, messages] of [
      ['en', en],
      ['hr', hr],
    ] as const) {
      for (const [key, value] of messages) {
        expect(value.trim(), `${code} ${key}`).not.toBe('');
        const base = key.replace(PLURAL, '');
        const source = en.get(key) ?? en.get(`${base}_other`) ?? '';
        expect(placeholders(value), `${code} ${key}`).toEqual(placeholders(source));
      }
    }
  });
});

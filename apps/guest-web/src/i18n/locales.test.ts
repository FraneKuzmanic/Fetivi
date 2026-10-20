import { readFileSync } from 'node:fs';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { describe, expect, it } from 'vitest';
import { locales } from './index';

const REVIEW_MARKER =
  '// Machine-drafted, unreviewed. Check with a native speaker before the pilot.';

/** `section.key` → string. */
function flatten(messages: Record<string, Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [section, keys] of Object.entries(messages)) {
    for (const [key, value] of Object.entries(keys)) out.set(`${section}.${key}`, value);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('locales', () => {
  const english = flatten(locales.en);

  it('cover every guest language', () => {
    expect(Object.keys(locales).sort()).toEqual([...GUEST_LANGUAGES].sort());
  });

  for (const code of GUEST_LANGUAGES) {
    it(`${code} has the English keys and placeholders, none empty`, () => {
      const messages = flatten(locales[code]);
      expect([...messages.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [key, value] of messages) {
        expect(value.trim(), key).not.toBe('');
        expect(placeholders(value), key).toEqual(placeholders(english.get(key) ?? ''));
      }
    });
  }

  for (const code of GUEST_LANGUAGES.filter((c) => c !== 'en')) {
    it(`${code} is marked for review`, () => {
      const source = readFileSync(new URL(`./locales/${code}.ts`, import.meta.url), 'utf8');
      expect(source.split(/\r?\n/)[0]).toBe(REVIEW_MARKER);
    });
  }
});

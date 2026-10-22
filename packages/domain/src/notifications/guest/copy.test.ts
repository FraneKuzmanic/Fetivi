import { describe, expect, it } from 'vitest';
import { GUEST_COPY } from './copy';
import { GUEST_NOTIFICATION_KINDS } from './vocabulary';

function leaves(value: unknown, path: string): [string, unknown][] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [[path, value]];
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '').sort();
}

describe('guest notification copy', () => {
  const english = new Map(leaves(GUEST_COPY.en, ''));

  it.each(Object.keys(GUEST_COPY))(
    '%s has the English keys and placeholders, none empty',
    (lang) => {
      const copy = new Map(leaves(GUEST_COPY[lang as keyof typeof GUEST_COPY], ''));
      expect([...copy.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [path, value] of copy) {
        expect(typeof value, path).toBe('string');
        expect((value as string).trim(), path).not.toBe('');
        expect(placeholders(value as string), `${lang}${path}`).toEqual(
          placeholders(english.get(path) as string),
        );
      }
    },
  );

  it('covers every kind', () => {
    for (const kind of GUEST_NOTIFICATION_KINDS) {
      expect(GUEST_COPY.en.kinds[kind].subject).toBeTruthy();
    }
  });

  it('never asks for a rating', () => {
    const text = [...english.values()].join(' ').toLowerCase();
    expect(text).not.toMatch(/\brat(e|ing)\b|stars?\b|enjoyed/);
  });
});

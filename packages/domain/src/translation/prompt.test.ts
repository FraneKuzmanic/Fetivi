import { describe, expect, it } from 'vitest';
import { GUEST_LANGUAGES } from '../property/vocabulary';
import { buildUserMessage, TRANSLATION_SYSTEM_PROMPT, TranslationOutput } from './prompt';

const slot = { title: 't', body: 'b' };
const translations = Object.fromEntries(GUEST_LANGUAGES.map((l) => [l, slot]));

describe('translation prompt', () => {
  it('names all seven languages', () => {
    for (const code of GUEST_LANGUAGES) expect(TRANSLATION_SYSTEM_PROMPT).toContain(`(${code})`);
  });

  it('fixes polite address per language', () => {
    for (const word of ['"Vi"', '"Sie"', '"vous"', '"Lei"', '"Państwo"', '"Ön"']) {
      expect(TRANSLATION_SYSTEM_PROMPT).toContain(word);
    }
  });

  it('keeps local place names', () => {
    expect(TRANSLATION_SYSTEM_PROMPT).toContain('never an exonym such as Spalato');
  });

  it('builds the user message from title and body', () => {
    expect(buildUserMessage({ title: 'Wi-Fi', body: 'Code: {{wifi}}' })).toBe(
      'Title:\nWi-Fi\n\nBody:\nCode: {{wifi}}',
    );
  });
});

describe('TranslationOutput', () => {
  it('accepts all seven languages', () => {
    expect(TranslationOutput.safeParse({ source_language: 'hr', translations }).success).toBe(true);
  });

  it('rejects a missing language', () => {
    const { fr: _fr, ...six } = translations;
    expect(TranslationOutput.safeParse({ source_language: 'hr', translations: six }).success).toBe(
      false,
    );
  });

  it('rejects an extra key', () => {
    const extra = { ...translations, es: slot };
    expect(
      TranslationOutput.safeParse({ source_language: 'hr', translations: extra }).success,
    ).toBe(false);
  });
});

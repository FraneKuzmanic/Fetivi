import { describe, expect, it } from 'vitest';
import { GUEST_LANGUAGES } from '../property/vocabulary';
import { handOverMessages, OPTIONAL_LINE } from './handover';

const LINK = 'https://guest.fetivi.test/u/k7mx9q2p';
const PIN = '048213';
const count = (text: string, part: string) => text.split(part).length - 1;

describe.each(GUEST_LANGUAGES)('handOverMessages (%s)', (language) => {
  const messages = handOverMessages({
    language,
    unitName: 'Apartment Lavanda',
    checkIn: '2026-10-21',
    checkout: '2026-10-24',
    pin: PIN,
    unitLink: LINK,
  });

  it('contains the PIN once in each variant', () => {
    expect(count(messages.withLink, PIN)).toBe(1);
    expect(count(messages.withoutLink, PIN)).toBe(1);
  });

  it('inserts the link exactly once and unchanged, so the PIN is never inside it', () => {
    expect(count(messages.withLink, LINK)).toBe(1);
    const after = messages.withLink.slice(messages.withLink.indexOf(LINK) + LINK.length);
    expect(after.startsWith('\n')).toBe(true);
  });

  it('has no link in the variant for OTA message filters', () => {
    expect(messages.withoutLink).not.toContain('http');
    expect(messages.withoutLink).not.toContain('guest.fetivi.test');
  });

  it('says Fetivi is optional in both variants', () => {
    expect(messages.withLink).toContain(OPTIONAL_LINE[language]);
    expect(messages.withoutLink).toContain(OPTIONAL_LINE[language]);
  });

  it('names the unit', () => {
    expect(messages.withLink).toContain('Apartment Lavanda');
    expect(messages.withoutLink).toContain('Apartment Lavanda');
  });
});

describe('hand-over dates', () => {
  const input = {
    unitName: 'Lavanda',
    checkIn: '2026-10-01',
    checkout: '2026-10-31',
    pin: PIN,
    unitLink: LINK,
  };

  it('localizes month names', () => {
    expect(handOverMessages({ ...input, language: 'de' }).withLink).toContain('Oktober');
    expect(handOverMessages({ ...input, language: 'en' }).withLink).toContain('October');
    expect(handOverMessages({ ...input, language: 'fr' }).withLink).toContain('octobre');
  });

  it('keeps the civil date (first and last of the month do not shift)', () => {
    const text = handOverMessages({ ...input, language: 'en' }).withLink;
    expect(text).toMatch(/\b1 October|October 1\b/);
    expect(text).toMatch(/\b31 October|October 31\b/);
  });
});

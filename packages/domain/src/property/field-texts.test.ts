import { describe, expect, it } from 'vitest';
import { type LocalizableText, localizeFieldText } from './field-texts';

const text = (over: Partial<LocalizableText> = {}): LocalizableText => ({
  owner: 'property',
  kind: 'access_instructions',
  amenity: null,
  source: 'Uzmite plava vrata.',
  revision: 2,
  translations: [{ revision: 2, language: 'de', text: 'Nehmen Sie das blaue Tor.' }],
  ...over,
});

describe('localizeFieldText', () => {
  it('serves the translation made from the current source at the current revision', () => {
    expect(
      localizeFieldText(
        'Uzmite plava vrata.',
        'property',
        'access_instructions',
        null,
        [text()],
        'de',
      ),
    ).toBe('Nehmen Sie das blaue Tor.');
  });

  it('serves the source when the field changed since the translation (never stale)', () => {
    expect(
      localizeFieldText(
        'Uzmite zelena vrata.',
        'property',
        'access_instructions',
        null,
        [text()],
        'de',
      ),
    ).toBe('Uzmite zelena vrata.');
  });

  it('serves the source when the translation is of an older revision', () => {
    const old = text({ translations: [{ revision: 1, language: 'de', text: 'Alt.' }] });
    expect(
      localizeFieldText(
        'Uzmite plava vrata.',
        'property',
        'access_instructions',
        null,
        [old],
        'de',
      ),
    ).toBe('Uzmite plava vrata.');
  });

  it('serves the source when the language is missing', () => {
    expect(
      localizeFieldText(
        'Uzmite plava vrata.',
        'property',
        'access_instructions',
        null,
        [text()],
        'fr',
      ),
    ).toBe('Uzmite plava vrata.');
  });

  it('picks the text of the owner the value came from', () => {
    const same = 'Uzmite plava vrata.';
    const texts = [
      text({ translations: [{ revision: 2, language: 'de', text: 'Property DE' }] }),
      text({
        owner: 'unit',
        revision: 1,
        translations: [{ revision: 1, language: 'de', text: 'Unit DE' }],
      }),
    ];
    expect(localizeFieldText(same, 'unit', 'access_instructions', null, texts, 'de')).toBe(
      'Unit DE',
    );
    expect(localizeFieldText(same, 'property', 'access_instructions', null, texts, 'de')).toBe(
      'Property DE',
    );
  });

  it('matches the field kind', () => {
    expect(
      localizeFieldText('Uzmite plava vrata.', 'property', 'parking_notes', null, [text()], 'de'),
    ).toBe('Uzmite plava vrata.');
  });

  it('returns null for a null value', () => {
    expect(
      localizeFieldText(null, 'property', 'access_instructions', null, [text()], 'de'),
    ).toBeNull();
  });

  it('matches amenity notes by amenity', () => {
    const texts = [
      text({
        kind: 'amenity_note',
        amenity: 'pool',
        source: 'Otvoren do 20h.',
        translations: [{ revision: 2, language: 'de', text: 'Bis 20 Uhr geöffnet.' }],
      }),
    ];
    expect(
      localizeFieldText('Otvoren do 20h.', 'property', 'amenity_note', 'pool', texts, 'de'),
    ).toBe('Bis 20 Uhr geöffnet.');
    expect(
      localizeFieldText('Otvoren do 20h.', 'property', 'amenity_note', 'hot_tub', texts, 'de'),
    ).toBe('Otvoren do 20h.');
  });
});

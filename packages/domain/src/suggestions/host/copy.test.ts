import { describe, expect, it } from 'vitest';
import { GUEST_LANGUAGES } from '../../property/vocabulary';
import { WIZARD_COPY } from '../../property/wizard-copy';
import { suggestionText } from './copy';
import { GAP_TOPICS, gapTarget } from './vocabulary';

describe('suggestionText', () => {
  it('renders every topic in every language with the count, label and step', () => {
    for (const lang of GUEST_LANGUAGES) {
      for (const topic of GAP_TOPICS) {
        const text = suggestionText(lang, topic, 3);
        expect(text).toContain('3');
        expect(text).toContain(WIZARD_COPY[lang].fields[topic].label);
        expect(text).toContain(WIZARD_COPY[lang].steps[gapTarget(topic).stepId].title);
        expect(text).not.toMatch(/[{}]|undefined/);
      }
    }
  });

  it('reads as Fetivi in English', () => {
    expect(suggestionText('en', 'laundry', 2)).toBe(
      'Guests in 2 stays asked about “Laundry”, and Fetivi had no answer. Add it under “How-tos” so Fetivi can answer next time.',
    );
  });

  it('uses the Croatian plural forms', () => {
    expect(suggestionText('hr', 'laundry', 2)).toContain('U 2 boravka ');
    expect(suggestionText('hr', 'laundry', 5)).toContain('U 5 boravaka ');
    expect(suggestionText('hr', 'laundry', 21)).toContain('U 21 boravku ');
  });
});

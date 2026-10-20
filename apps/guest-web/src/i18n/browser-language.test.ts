import { describe, expect, it } from 'vitest';
import { pickBrowserLanguage } from './browser-language';

describe('pickBrowserLanguage', () => {
  it('takes the first browser language we speak, by its primary subtag', () => {
    expect(pickBrowserLanguage(['de-AT', 'en'])).toBe('de');
    expect(pickBrowserLanguage(['es', 'hr'])).toBe('hr');
    expect(pickBrowserLanguage(['HU-hu'])).toBe('hu');
  });

  it('falls back to English', () => {
    expect(pickBrowserLanguage([])).toBe('en');
    expect(pickBrowserLanguage(['ES'])).toBe('en');
  });
});

import { describe, expect, it } from 'vitest';
import { pickBrowserLanguage } from './browser-language';

describe('pickBrowserLanguage', () => {
  it('picks Croatian when the first browser language is Croatian', () => {
    expect(pickBrowserLanguage(['hr-HR'])).toBe('hr');
    expect(pickBrowserLanguage(['hr', 'en'])).toBe('hr');
    expect(pickBrowserLanguage(['HR-hr'])).toBe('hr');
  });

  it('picks English otherwise, even with Croatian further down', () => {
    expect(pickBrowserLanguage(['en-US', 'hr'])).toBe('en');
    expect(pickBrowserLanguage(['de', 'hr'])).toBe('en');
    expect(pickBrowserLanguage(['de-AT'])).toBe('en');
    expect(pickBrowserLanguage([])).toBe('en');
  });
});

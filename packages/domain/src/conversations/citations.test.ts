import { describe, expect, it } from 'vitest';
import { citationsAsHosts, keptTextParts } from './citations';

const webResults = (...hosts: string[]) => ({
  type: 'data-component',
  id: 'search',
  data: {
    name: 'web-results',
    payload: { results: hosts.map((host) => ({ source: { host, kind: 'other' } })) },
  },
});

describe('citationsAsHosts', () => {
  it('reads each marker as its host, without www', () => {
    expect(
      citationsAsHosts('Open daily [1]. Ferries [2].', ['www.visittrogir.hr', 'jadrolinija.hr']),
    ).toBe('Open daily (visittrogir.hr). Ferries (jadrolinija.hr).');
  });

  it('drops markers cleanly without results, leaving no space before punctuation', () => {
    expect(citationsAsHosts('Open daily [1].', [])).toBe('Open daily.');
  });

  it('names a repeated citation once and drops one out of range', () => {
    expect(citationsAsHosts('Open daily [1][1] [9].', ['split.gov.hr'])).toBe(
      'Open daily (split.gov.hr).',
    );
  });

  it('leaves no leading space when the text starts with a marker', () => {
    expect(citationsAsHosts('[1] Tours run daily.', [])).toBe('Tours run daily.');
  });
});

describe('keptTextParts', () => {
  it('keeps text parts only, resolving markers after a search', () => {
    expect(
      keptTextParts([
        { type: 'tool-web_fallback_search', output: {} },
        webResults('visittrogir.hr'),
        { type: 'text', text: 'Open daily [1].' },
      ]),
    ).toEqual([{ type: 'text', text: 'Open daily (visittrogir.hr).' }]);
  });

  it('leaves brackets alone in an answer with no search', () => {
    const parts = [{ type: 'text', text: 'Room [1] is upstairs.' }];
    expect(keptTextParts(parts)).toEqual(parts);
  });

  it('uses the latest search for the text after it', () => {
    expect(
      keptTextParts([
        webResults('a.hr'),
        { type: 'text', text: 'First [1].' },
        webResults('b.hr'),
        { type: 'text', text: 'Second [1].' },
      ]),
    ).toEqual([
      { type: 'text', text: 'First (a.hr).' },
      { type: 'text', text: 'Second (b.hr).' },
    ]);
  });
});

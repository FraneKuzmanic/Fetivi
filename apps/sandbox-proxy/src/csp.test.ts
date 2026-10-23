import { describe, expect, it } from 'vitest';
import { buildCspHeader, parseCspParam } from './csp';

const APP = 'http://localhost:5173';
// The CSP Ferryhopper's picker declares (recorded fixture).
const FERRYHOPPER_CSP = {
  connectDomains: ['https://www.ferryhopper.com'],
  resourceDomains: [
    'https://images.ferryhopper.com',
    'https://cdn.ferryhopper.com',
    'https://cdn1.ferryhopper.com',
  ],
};

const directive = (header: string, name: string) =>
  header.split('; ').find((d) => d.startsWith(`${name} `));

describe('buildCspHeader', () => {
  it('applies the domains a widget declares', () => {
    const header = buildCspHeader(FERRYHOPPER_CSP, APP);
    expect(directive(header, 'connect-src')).toBe("connect-src 'self' https://www.ferryhopper.com");
    expect(directive(header, 'img-src')).toContain('https://images.ferryhopper.com');
    expect(directive(header, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(header, 'frame-ancestors')).toBe(`frame-ancestors ${APP}`);
  });

  it('falls back to the restrictive default when nothing is declared', () => {
    const header = buildCspHeader(undefined, APP);
    expect(directive(header, 'default-src')).toBe("default-src 'none'");
    expect(directive(header, 'connect-src')).toBe("connect-src 'none'");
    expect(directive(header, 'frame-ancestors')).toBe(`frame-ancestors ${APP}`);
  });

  it('drops entries that try to break out of their directive', () => {
    const header = buildCspHeader(
      {
        connectDomains: [
          'a.com; script-src *',
          "'unsafe-eval'",
          'a.com b.com',
          'x.com\nscript-src *',
          'ok.com',
        ],
      },
      APP,
    );
    expect(directive(header, 'connect-src')).toBe("connect-src 'self' ok.com");
    expect(header.split('; ').filter((d) => d.startsWith('script-src'))).toHaveLength(1);
  });
});

describe('parseCspParam', () => {
  it('reads the declared domains from JSON', () => {
    expect(parseCspParam(JSON.stringify(FERRYHOPPER_CSP))).toEqual(FERRYHOPPER_CSP);
  });

  it('keeps only known keys and string entries', () => {
    expect(
      parseCspParam(JSON.stringify({ connectDomains: ['a.com', 3], scriptSrc: ['*'] })),
    ).toEqual({
      connectDomains: ['a.com'],
    });
  });

  it('treats anything malformed as no CSP', () => {
    for (const raw of [null, '', 'not json', '[]', '"x"', 'null']) {
      expect(parseCspParam(raw)).toBeUndefined();
    }
  });
});

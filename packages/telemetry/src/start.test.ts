import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTelemetry, withoutQuery } from './start';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('withoutQuery', () => {
  it('keeps origin and path only', () => {
    expect(withoutQuery('https://api.search.brave.com/res/v1/web/search?q=guest%20text')).toBe(
      'https://api.search.brave.com/res/v1/web/search',
    );
  });

  it('returns what does not parse unchanged', () => {
    expect(withoutQuery('not a url')).toBe('not a url');
  });
});

describe('startTelemetry', () => {
  it('does nothing when OTEL_SDK_DISABLED is true', () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true');
    expect(startTelemetry('x')).toBeNull();
  });
});

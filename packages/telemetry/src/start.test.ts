import { afterEach, describe, expect, it, vi } from 'vitest';
import { outgoingUrl, startTelemetry } from './start';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('outgoingUrl', () => {
  it('keeps the origin and redacts path and query', () => {
    const attributes = outgoingUrl('https://fcm.googleapis.com');
    expect(attributes).toEqual({
      'url.full': 'https://fcm.googleapis.com',
      'url.path': 'redacted',
      'url.query': 'redacted',
    });
  });
});

describe('startTelemetry', () => {
  it('does nothing when OTEL_SDK_DISABLED is true', () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true');
    expect(startTelemetry('x')).toBeNull();
  });
});

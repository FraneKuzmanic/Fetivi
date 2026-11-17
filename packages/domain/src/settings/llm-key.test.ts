import { describe, expect, it, vi } from 'vitest';
import { decryptLlmKey, encryptLlmKey, fixedKey } from './llm-key';
import { checkAnthropicKey } from './llm-key-check';

const SECRET = 'unit-test-llm-key-secret-of-32-chars-plus';
const KEY = 'sk-ant-api03-unit-test-key-abcd';

describe('llm key encryption', () => {
  it('round-trips and never contains the key in clear', () => {
    const stored = encryptLlmKey(KEY, SECRET);
    expect(stored).not.toContain(KEY);
    expect(decryptLlmKey(stored, SECRET)).toBe(KEY);
  });

  it('differs per encryption (random IV)', () => {
    expect(encryptLlmKey(KEY, SECRET)).not.toBe(encryptLlmKey(KEY, SECRET));
  });

  it('gives null under another secret', () => {
    expect(decryptLlmKey(encryptLlmKey(KEY, SECRET), `${SECRET}-rotated`)).toBeNull();
  });

  it('gives null when the data or the tag is tampered with', () => {
    const [iv, tag, data] = encryptLlmKey(KEY, SECRET).split('.') as [string, string, string];
    const flip = (b64: string) => {
      const bytes = Buffer.from(b64, 'base64');
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      return bytes.toString('base64');
    };
    expect(decryptLlmKey([iv, tag, flip(data)].join('.'), SECRET)).toBeNull();
    expect(decryptLlmKey([iv, flip(tag), data].join('.'), SECRET)).toBeNull();
  });

  it('gives null for malformed input', () => {
    expect(decryptLlmKey('', SECRET)).toBeNull();
    expect(decryptLlmKey('not-encrypted', SECRET)).toBeNull();
    expect(decryptLlmKey('a.b.c', SECRET)).toBeNull();
    expect(decryptLlmKey('a.b.c.d', SECRET)).toBeNull();
  });
});

describe('fixedKey', () => {
  it('treats an empty key as not configured', async () => {
    expect(await fixedKey('')()).toBeUndefined();
    expect(await fixedKey(undefined)()).toBeUndefined();
    expect(await fixedKey('k')()).toBe('k');
  });
});

describe('checkAnthropicKey', () => {
  const reply = (body: unknown, status: number) =>
    vi.fn(
      async (_url: string | URL) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );

  it('is not configured without a key, and calls nothing', async () => {
    const fetch = vi.fn();
    expect(await checkAnthropicKey(undefined, fetch)).toEqual({
      ok: false,
      error: 'not-configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a key the models list answers for', async () => {
    const fetch = reply({ data: [], has_more: false, first_id: null, last_id: null }, 200);
    expect(await checkAnthropicKey(KEY, fetch)).toEqual({ ok: true });
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/v1/models');
  });

  it('reports a 401 or 403 as rejected', async () => {
    const error = { type: 'error', error: { type: 'authentication_error', message: 'bad key' } };
    expect(await checkAnthropicKey(KEY, reply(error, 401))).toEqual({
      ok: false,
      error: 'rejected',
    });
    expect(await checkAnthropicKey(KEY, reply(error, 403))).toEqual({
      ok: false,
      error: 'rejected',
    });
  });

  it('reports a network failure as unreachable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await checkAnthropicKey(KEY, fetch)).toEqual({ ok: false, error: 'unreachable' });
  });
});

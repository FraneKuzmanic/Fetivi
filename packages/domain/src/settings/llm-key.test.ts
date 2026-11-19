import { describe, expect, it } from 'vitest';
import { decryptLlmKey, encryptLlmKey, fixedKey } from './llm-key';

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
    expect(await fixedKey('k')()).toEqual({ provider: 'anthropic', key: 'k', model: null });
  });
});

import { describe, expect, it } from 'vitest';
import { hashPassword, Password, verifyAgainstDummy, verifyPassword } from './passwords';

describe('passwords', () => {
  it('hashes with argon2id', async () => {
    const hashed = await hashPassword('correct horse battery');
    expect(hashed).not.toBe('correct horse battery');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hashed = await hashPassword('correct horse battery');
    expect(await verifyPassword(hashed, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong horse battery')).toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything123')).toBe(false);
  });

  it('runs the dummy check without throwing', async () => {
    await expect(verifyAgainstDummy('anything123')).resolves.toBeUndefined();
  });

  it('enforces 10 to 128 characters', () => {
    expect(Password.safeParse('a'.repeat(9)).success).toBe(false);
    expect(Password.safeParse('a'.repeat(10)).success).toBe(true);
    expect(Password.safeParse('a'.repeat(128)).success).toBe(true);
    expect(Password.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

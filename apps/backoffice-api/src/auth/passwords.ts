import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const Password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

/** argon2id with the library defaults (m=19456 KiB, t=2, p=1, the OWASP minimum). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so an unknown email is not faster to reject. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hash('fetivi-dummy-password');
  await verifyPassword(await dummyHash, password);
}

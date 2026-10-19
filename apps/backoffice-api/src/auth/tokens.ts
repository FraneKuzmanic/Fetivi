import { createHash, randomBytes } from 'node:crypto';

/** 256 random bits, base64url (43 characters). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hex SHA-256; what the database stores instead of the token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

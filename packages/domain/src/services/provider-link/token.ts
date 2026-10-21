import { createHmac } from 'node:crypto';

// The per-order Provider link token is derived, not random, so a retried email job can rebuild the
// same link while the database keeps only its hash. Without the secret it cannot be guessed.

/** 32 bytes, base64url: 43 characters. */
export const PROVIDER_LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function providerLinkToken(secret: string, orderId: string): string {
  return createHmac('sha256', secret).update(`provider-link:${orderId}`).digest('base64url');
}

export function providerLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/provider-link/${token}`;
}

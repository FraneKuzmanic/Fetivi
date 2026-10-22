import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { spaces } from '../db/schema/spaces';

// The one-click unsubscribe link of a daily-tip email. Derived, not random, so a retried email job
// rebuilds a byte-identical body (Resend idempotency). Never carries the email address.

/** 32 bytes, base64url: 43 characters. */
export const TIPS_UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tipsUnsubscribeToken(secret: string, spaceId: string): string {
  return createHmac('sha256', secret).update(`tips-unsubscribe:${spaceId}`).digest('base64url');
}

export function verifyTipsUnsubscribe(secret: string, spaceId: string, token: string): boolean {
  const expected = Buffer.from(tipsUnsubscribeToken(secret, spaceId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The guest page that unsubscribes on open, and the RFC 8058 one-click POST target. */
export function tipsUnsubscribeUrls(
  guestOrigin: string,
  spaceId: string,
  token: string,
): { page: string; oneClick: string } {
  const origin = guestOrigin.replace(/\/+$/, '');
  const query = `space=${encodeURIComponent(spaceId)}&token=${encodeURIComponent(token)}`;
  return {
    page: `${origin}/unsubscribe-tips?${query}`,
    oneClick: `${origin}/api/email/tips/unsubscribe?${query}`,
  };
}

/**
 * Turns tip emails off. Idempotent and without preconditions (unlike `setTipsOptIn`); a deleted
 * space is a no-op, so the link reveals nothing.
 */
export async function unsubscribeTips(db: Executor, spaceId: string, now: Date): Promise<void> {
  await db
    .update(spaces)
    .set({ tipsEmailOptInAt: null, updatedAt: now })
    .where(eq(spaces.id, spaceId));
}

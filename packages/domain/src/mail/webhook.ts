import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Resend signs webhooks with Svix. Verified by hand (no library): HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` with the base64 secret after `whsec_`, base64 output, compared
// against each space-separated `v1,<sig>` entry.

/** A timestamp further than this from now is rejected, so a captured request cannot be replayed later. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface ResendWebhookInput {
  secret: string;
  headers: {
    id: string | undefined;
    timestamp: string | undefined;
    signature: string | undefined;
  };
  rawBody: string;
  now: Date;
}

export function verifyResendWebhook(input: ResendWebhookInput): boolean {
  const { id, timestamp, signature } = input.headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(input.secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${input.rawBody}`).digest();
  for (const entry of signature.split(' ')) {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

const resendEvent = z.object({
  type: z.string(),
  data: z
    .object({
      to: z.array(z.string()).default([]),
      bounce: z.object({ type: z.string().optional() }).partial().optional(),
    })
    .partial()
    .default({}),
});

export interface ResendEvent {
  type: 'bounced' | 'complained' | 'other';
  recipients: string[];
  /** A hard bounce: Resend's bounce type `Permanent`. */
  permanent: boolean;
}

/** The parts of a verified event the suppression list needs; unknown types become 'other'. */
export function parseResendEvent(json: unknown): ResendEvent {
  const parsed = resendEvent.safeParse(json);
  if (!parsed.success) return { type: 'other', recipients: [], permanent: false };
  const { type, data } = parsed.data;
  const recipients = data.to ?? [];
  if (type === 'email.bounced') {
    return { type: 'bounced', recipients, permanent: data.bounce?.type === 'Permanent' };
  }
  if (type === 'email.complained') return { type: 'complained', recipients, permanent: false };
  return { type: 'other', recipients: [], permanent: false };
}

import type { Egress } from '@fetivi/egress';
import type { Mailer } from './index';

// Resend over plain REST: no SDK, and the caller passes the egress `fetch`, so the send goes
// through the outbound allowlist like every other call.

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** Resend rejects longer keys; it keeps a key for 24 hours. */
export const IDEMPOTENCY_KEY_MAX = 256;

/** A non-2xx answer. The body is not kept: it can echo addresses. pg-boss retries the job. */
export class MailSendError extends Error {
  constructor(readonly status: number) {
    super(`resend send failed: ${status}`);
    this.name = 'MailSendError';
  }
}

export interface ResendMailerConfig {
  apiKey: string;
  from: string;
  fetch: Egress['fetch'];
}

export function createResendMailer(config: ResendMailerConfig): Mailer {
  return {
    async send({ to, subject, text, idempotencyKey, headers: messageHeaders }) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (idempotencyKey !== undefined) {
        if (idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
          throw new Error(`idempotency key longer than ${IDEMPOTENCY_KEY_MAX} characters`);
        }
        headers['Idempotency-Key'] = idempotencyKey;
      }
      const response = await config.fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject,
          text,
          ...(messageHeaders ? { headers: messageHeaders } : {}),
        }),
      });
      if (!response.ok) throw new MailSendError(response.status);
    },
  };
}

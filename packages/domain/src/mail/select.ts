import type { Egress } from '@fetivi/egress';
import { createConsoleMailer, type Mailer } from './index';
import { createResendMailer } from './resend';

export const MAIL_TRANSPORTS = ['console', 'resend'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

export interface MailerConfig {
  transport: MailTransport;
  resendApiKey?: string | undefined;
  from: string;
  fetch: Egress['fetch'];
}

/** The process's mailer: console in development, Resend when configured (config refines require the key). */
export function createMailer(config: MailerConfig): Mailer {
  if (config.transport === 'console') return createConsoleMailer();
  if (!config.resendApiKey) throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY');
  return createResendMailer({
    apiKey: config.resendApiKey,
    from: config.from,
    fetch: config.fetch,
  });
}

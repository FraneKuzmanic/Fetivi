import { createEgress, type Egress } from '@fetivi/egress';
import { createConsoleMailer, type Mailer } from './index';
import { createMailpitMailer } from './mailpit';
import { createResendMailer } from './resend';

export const MAIL_TRANSPORTS = ['console', 'mailpit', 'resend'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

export interface MailerConfig {
  transport: MailTransport;
  resendApiKey?: string | undefined;
  /** Mailpit's web address on this machine (development only). */
  mailpitUrl?: string | undefined;
  from: string;
  fetch: Egress['fetch'];
}

/**
 * The process's mailer: console in development, Mailpit to follow mail in a local inbox, Resend
 * when configured (config refines require the key). Mailpit gets its own egress that reaches only
 * this machine, so the process's outbound allowlist never opens to plain http.
 */
export function createMailer(config: MailerConfig): Mailer {
  if (config.transport === 'console') return createConsoleMailer();
  if (config.transport === 'mailpit') {
    const url = new URL(config.mailpitUrl ?? 'http://localhost:8025');
    if (!LOCAL_HOSTS.includes(url.hostname)) {
      throw new Error('MAIL_TRANSPORT=mailpit needs MAILPIT_URL on localhost');
    }
    const egress = createEgress({ allowlist: LOCAL_HOSTS, allowInsecureLocalhost: true });
    return createMailpitMailer({ url: url.toString(), from: config.from, fetch: egress.fetch });
  }
  if (!config.resendApiKey) throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY');
  return createResendMailer({
    apiKey: config.resendApiKey,
    from: config.from,
    fetch: config.fetch,
  });
}

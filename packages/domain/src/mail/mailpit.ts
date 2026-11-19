import type { Egress } from '@fetivi/egress';
import type { Mailer } from './index';
import { MailSendError } from './resend';

// Mailpit, a local mail catcher for development: mail goes to its send API and shows in its web
// inbox, so a flow can be followed through the real e-mail without sending anything out.

export interface MailpitMailerConfig {
  /** Mailpit's web address, e.g. http://localhost:8025. */
  url: string;
  from: string;
  fetch: Egress['fetch'];
}

/** 'Fetivi <n@x.test>' or a bare 'n@x.test'. */
function sender(from: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { Email: from.trim() };
  const [, name = '', email = ''] = match;
  return name ? { Email: email, Name: name } : { Email: email };
}

export function createMailpitMailer(config: MailpitMailerConfig): Mailer {
  const endpoint = new URL('/api/v1/send', config.url).toString();
  return {
    async send({ to, subject, text, headers }) {
      const response = await config.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: sender(config.from),
          To: [{ Email: to }],
          Subject: subject,
          Text: text,
          ...(headers ? { Headers: headers } : {}),
        }),
      });
      if (!response.ok) throw new MailSendError(response.status);
    },
  };
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Forwarded by transports that support it, such as Resend's Idempotency-Key. */
  idempotencyKey?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Dev transport: prints the message, including links, to the log. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send({ to, subject, text, idempotencyKey }) {
      const key = idempotencyKey ? `\nIdempotency-Key: ${idempotencyKey}` : '';
      log(`--- mail ---\nTo: ${to}${key}\nSubject: ${subject}\n\n${text}\n--- end mail ---`);
    },
  };
}

/** Test inbox: keeps sent messages in memory. */
export function createMemoryMailer(): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

export * from './resend';
export * from './select';
export * from './webhook';

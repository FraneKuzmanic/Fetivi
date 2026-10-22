export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Forwarded by transports that support it, such as Resend's Idempotency-Key. */
  idempotencyKey?: string;
  /** Extra message headers, such as RFC 8058 `List-Unsubscribe`. */
  headers?: Record<string, string>;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Dev transport: prints the message, including links, to the log. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send({ to, subject, text, idempotencyKey, headers }) {
      const key = idempotencyKey ? `\nIdempotency-Key: ${idempotencyKey}` : '';
      const extra = Object.entries(headers ?? {})
        .map(([name, value]) => `\n${name}: ${value}`)
        .join('');
      log(
        `--- mail ---\nTo: ${to}${key}${extra}\nSubject: ${subject}\n\n${text}\n--- end mail ---`,
      );
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

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Dev transport: prints the message, including links, to the log. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send({ to, subject, text }) {
      log(`--- mail ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- end mail ---`);
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

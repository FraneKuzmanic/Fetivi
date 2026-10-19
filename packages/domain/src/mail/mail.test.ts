import { describe, expect, it } from 'vitest';
import { createConsoleMailer, createMemoryMailer } from '.';

describe('mail transports', () => {
  it('memory mailer records messages in order', async () => {
    const mailer = createMemoryMailer();
    await mailer.send({ to: 'a@example.test', subject: 'One', text: 'first' });
    await mailer.send({ to: 'b@example.test', subject: 'Two', text: 'second' });
    expect(mailer.sent.map((m) => m.subject)).toEqual(['One', 'Two']);
  });

  it('console mailer logs recipient, subject and text', async () => {
    const lines: string[] = [];
    const mailer = createConsoleMailer((line) => lines.push(line));
    await mailer.send({
      to: 'a@example.test',
      subject: 'Hello',
      text: 'https://x.test/?token=abc',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a@example.test');
    expect(lines[0]).toContain('Hello');
    expect(lines[0]).toContain('https://x.test/?token=abc');
  });
});

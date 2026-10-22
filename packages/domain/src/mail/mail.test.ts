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

  it('console mailer prints the idempotency key, and the memory mailer keeps it', async () => {
    const lines: string[] = [];
    await createConsoleMailer((line) => lines.push(line)).send({
      to: 'a@example.test',
      subject: 'Hi',
      text: 'x',
      idempotencyKey: 'order:1:notify',
    });
    expect(lines[0]).toContain('Idempotency-Key: order:1:notify');
    const memory = createMemoryMailer();
    await memory.send({ to: 'a@example.test', subject: 'Hi', text: 'x', idempotencyKey: 'k' });
    expect(memory.sent[0]?.idempotencyKey).toBe('k');
  });

  it('console mailer prints message headers, and the memory mailer keeps them', async () => {
    const lines: string[] = [];
    const headers = { 'List-Unsubscribe': '<https://x.test/u>' };
    await createConsoleMailer((line) => lines.push(line)).send({
      to: 'a@example.test',
      subject: 'Hi',
      text: 'x',
      headers,
    });
    expect(lines[0]).toContain('List-Unsubscribe: <https://x.test/u>');
    const memory = createMemoryMailer();
    await memory.send({ to: 'a@example.test', subject: 'Hi', text: 'x', headers });
    expect(memory.sent[0]?.headers).toEqual(headers);
  });
});

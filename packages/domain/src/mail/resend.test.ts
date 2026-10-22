import type { Egress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { createConsoleMailer, createMailer, createResendMailer, MailSendError } from '.';

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: 'email-1' }), { status });
  }) as Egress['fetch'];
  return { fn, calls };
}

describe('createResendMailer', () => {
  it('posts the message with bearer auth and the idempotency key', async () => {
    const { fn, calls } = fakeFetch();
    const mailer = createResendMailer({ apiKey: 're_test', from: 'Fetivi <n@x.test>', fetch: fn });
    await mailer.send({ to: 'g@x.test', subject: 'Hi', text: 'Body', idempotencyKey: 'k:email' });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.resend.com/emails');
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(headers['Idempotency-Key']).toBe('k:email');
    expect(JSON.parse(String(call?.init.body))).toEqual({
      from: 'Fetivi <n@x.test>',
      to: ['g@x.test'],
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('omits the header without a key', async () => {
    const { fn, calls } = fakeFetch();
    await createResendMailer({ apiKey: 'k', from: 'f@x.test', fetch: fn }).send({
      to: 'g@x.test',
      subject: 'S',
      text: 'T',
    });
    expect(calls[0]?.init.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('throws MailSendError on a non-2xx answer', async () => {
    const { fn } = fakeFetch(422);
    const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.test', fetch: fn });
    const error = await mailer.send({ to: 'g@x.test', subject: 'S', text: 'T' }).catch((e) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect(error.status).toBe(422);
  });

  it('rejects a key longer than 256 characters without sending', async () => {
    const { fn, calls } = fakeFetch();
    const mailer = createResendMailer({ apiKey: 'k', from: 'f@x.test', fetch: fn });
    await expect(
      mailer.send({ to: 'g@x.test', subject: 'S', text: 'T', idempotencyKey: 'x'.repeat(257) }),
    ).rejects.toThrow(/256/);
    expect(calls).toHaveLength(0);
  });
});

describe('createMailer', () => {
  it('picks the console transport', () => {
    const mailer = createMailer({ transport: 'console', from: 'f', fetch: fakeFetch().fn });
    expect(Object.keys(mailer)).toEqual(Object.keys(createConsoleMailer()));
  });

  it('picks Resend and sends through the given fetch', async () => {
    const { fn, calls } = fakeFetch();
    const mailer = createMailer({ transport: 'resend', resendApiKey: 'k', from: 'f', fetch: fn });
    await mailer.send({ to: 'g@x.test', subject: 'S', text: 'T' });
    expect(calls).toHaveLength(1);
  });

  it('refuses Resend without a key', () => {
    expect(() => createMailer({ transport: 'resend', from: 'f', fetch: fakeFetch().fn })).toThrow();
  });
});

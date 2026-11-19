import type { Egress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { createMailer, createMailpitMailer, MailSendError } from '.';

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('{}', { status });
  }) as Egress['fetch'];
  return { fn, calls };
}

describe('createMailpitMailer', () => {
  it("posts the message to Mailpit's send API with the sender's name and headers", async () => {
    const { fn, calls } = fakeFetch();
    const mailer = createMailpitMailer({
      url: 'http://localhost:8025',
      from: 'Fetivi <notifications@localhost>',
      fetch: fn,
    });
    await mailer.send({
      to: 'p@x.test',
      subject: 'New request',
      text: 'Body',
      headers: { 'List-Unsubscribe': '<https://x.test/u>' },
    });
    expect(calls[0]?.url).toBe('http://localhost:8025/api/v1/send');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      From: { Email: 'notifications@localhost', Name: 'Fetivi' },
      To: [{ Email: 'p@x.test' }],
      Subject: 'New request',
      Text: 'Body',
      Headers: { 'List-Unsubscribe': '<https://x.test/u>' },
    });
  });

  it('takes a bare address as the sender', async () => {
    const { fn, calls } = fakeFetch();
    await createMailpitMailer({ url: 'http://localhost:8025/', from: 'n@x.test', fetch: fn }).send({
      to: 'p@x.test',
      subject: 'S',
      text: 'T',
    });
    expect(calls[0]?.url).toBe('http://localhost:8025/api/v1/send');
    expect(JSON.parse(String(calls[0]?.init.body)).From).toEqual({ Email: 'n@x.test' });
  });

  it('throws MailSendError on a non-2xx answer', async () => {
    const { fn } = fakeFetch(500);
    const mailer = createMailpitMailer({
      url: 'http://localhost:8025',
      from: 'n@x.test',
      fetch: fn,
    });
    await expect(mailer.send({ to: 'p@x.test', subject: 'S', text: 'T' })).rejects.toBeInstanceOf(
      MailSendError,
    );
  });
});

describe('createMailer with mailpit', () => {
  it('refuses a Mailpit address that is not on this machine', () => {
    const { fn } = fakeFetch();
    expect(() =>
      createMailer({
        transport: 'mailpit',
        mailpitUrl: 'http://mail.example.com:8025',
        from: 'n@x.test',
        fetch: fn,
      }),
    ).toThrow(/localhost/);
  });
});

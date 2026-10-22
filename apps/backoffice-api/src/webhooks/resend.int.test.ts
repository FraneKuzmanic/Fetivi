import { createHmac, randomBytes } from 'node:crypto';
import { emailSuppressions } from '@fetivi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing';

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString('base64')}`;

let t: TestApp;
let bare: TestApp;

beforeAll(async () => {
  t = await createTestApp({ resendWebhookSecret: SECRET });
  bare = await createTestApp();
});

afterAll(async () => {
  await t?.close();
  await bare?.close();
});

/** A Resend (Svix) delivery, signed with `key` at the app's clock. */
function deliver(app: TestApp, event: unknown, options: { id?: string; key?: Buffer } = {}) {
  const body = JSON.stringify(event);
  const id = options.id ?? `msg_${randomBytes(6).toString('hex')}`;
  const timestamp = String(Math.floor(app.clock.now().getTime() / 1000));
  const signature = createHmac('sha256', options.key ?? KEY)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return app.app.inject({
    method: 'POST',
    url: '/webhooks/resend',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    payload: body,
  });
}

const bounce = (to: string, type: string) => ({
  type: 'email.bounced',
  created_at: '2026-10-19T10:00:00Z',
  data: { email_id: 'e1', to: [to], bounce: { type, subType: 'General', message: 'x' } },
});

const suppressed = async () =>
  (await t.db.select().from(emailSuppressions)).map((r) => [r.email, r.reason]).sort();

describe('POST /webhooks/resend', () => {
  it('suppresses a permanent bounce and a complaint, once, and ignores the rest', async () => {
    const first = await deliver(t, bounce('Hard@Example.test', 'Permanent'), { id: 'msg_1' });
    expect(first.statusCode).toBe(200);
    // A replayed delivery adds nothing.
    expect(
      (await deliver(t, bounce('Hard@Example.test', 'Permanent'), { id: 'msg_1' })).statusCode,
    ).toBe(200);
    expect((await deliver(t, bounce('soft@example.test', 'Transient'))).statusCode).toBe(200);
    const complaint = { type: 'email.complained', data: { to: ['spam@example.test'] } };
    expect((await deliver(t, complaint)).statusCode).toBe(200);
    expect(
      (await deliver(t, { type: 'email.delivered', data: { to: ['ok@example.test'] } })).statusCode,
    ).toBe(200);
    expect(await suppressed()).toEqual([
      ['hard@example.test', 'bounced'],
      ['spam@example.test', 'complained'],
    ]);
  });

  it('rejects a bad signature without writing', async () => {
    const before = await suppressed();
    const res = await deliver(t, bounce('x@example.test', 'Permanent'), { key: randomBytes(24) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'bad-signature' });
    expect(await suppressed()).toEqual(before);
  });

  it('is not registered without a secret', async () => {
    const res = await deliver(bare, bounce('x@example.test', 'Permanent'));
    expect(res.statusCode).toBe(404);
  });
});

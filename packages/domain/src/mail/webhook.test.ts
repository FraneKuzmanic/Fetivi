import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseResendEvent, verifyResendWebhook } from '.';

const KEY = Buffer.from('fetivi-test-webhook-secret-bytes');
const SECRET = `whsec_${KEY.toString('base64')}`;
const NOW = new Date('2026-10-22T10:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
const BODY = JSON.stringify({ type: 'email.bounced', data: { to: ['a@x.test'] } });

function sign(id: string, ts: string, body: string, key = KEY): string {
  return createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

function input(
  over: Partial<{ signature: string; timestamp: string; body: string; secret: string }>,
) {
  return {
    secret: over.secret ?? SECRET,
    headers: {
      id: 'msg_1',
      timestamp: over.timestamp ?? TS,
      signature: over.signature ?? `v1,${sign('msg_1', TS, BODY)}`,
    },
    rawBody: over.body ?? BODY,
    now: NOW,
  };
}

describe('verifyResendWebhook', () => {
  it('accepts a valid signature', () => {
    expect(verifyResendWebhook(input({}))).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyResendWebhook(input({ body: `${BODY} ` }))).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const other = `whsec_${Buffer.from('another-secret').toString('base64')}`;
    expect(verifyResendWebhook(input({ secret: other }))).toBe(false);
  });

  it('rejects a timestamp older than five minutes', () => {
    const old = String(Number(TS) - 301);
    const signature = `v1,${sign('msg_1', old, BODY)}`;
    expect(verifyResendWebhook(input({ timestamp: old, signature }))).toBe(false);
  });

  it('accepts when one of several signatures is valid', () => {
    const signature = `v1,${Buffer.from('nope').toString('base64')} v1,${sign('msg_1', TS, BODY)}`;
    expect(verifyResendWebhook(input({ signature }))).toBe(true);
  });

  it('ignores signatures of other versions', () => {
    expect(verifyResendWebhook(input({ signature: `v2,${sign('msg_1', TS, BODY)}` }))).toBe(false);
  });

  it('rejects a missing header', () => {
    const value = input({});
    expect(verifyResendWebhook({ ...value, headers: { ...value.headers, id: undefined } })).toBe(
      false,
    );
  });
});

describe('parseResendEvent', () => {
  it('reads a permanent bounce', () => {
    expect(
      parseResendEvent({
        type: 'email.bounced',
        created_at: '2026-10-22T10:00:00Z',
        data: {
          email_id: 'e',
          to: ['a@x.test'],
          bounce: { type: 'Permanent', subType: 'General' },
        },
      }),
    ).toEqual({ type: 'bounced', recipients: ['a@x.test'], permanent: true });
  });

  it('reads a transient bounce as not permanent', () => {
    expect(
      parseResendEvent({
        type: 'email.bounced',
        data: { to: ['a@x.test'], bounce: { type: 'Transient' } },
      }).permanent,
    ).toBe(false);
  });

  it('reads a complaint', () => {
    expect(parseResendEvent({ type: 'email.complained', data: { to: ['a@x.test'] } })).toEqual({
      type: 'complained',
      recipients: ['a@x.test'],
      permanent: false,
    });
  });

  it('treats other and malformed events as other', () => {
    expect(parseResendEvent({ type: 'email.delivered', data: { to: ['a@x.test'] } }).type).toBe(
      'other',
    );
    expect(parseResendEvent('nonsense').type).toBe('other');
  });
});

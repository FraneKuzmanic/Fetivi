import { createECDH, randomBytes } from 'node:crypto';
import type { Egress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { createWebPushSender, isAllowedPushEndpoint, pushTopic } from './push';

const vapid = webpush.generateVAPIDKeys();

function subscriber(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

function fakeFetch(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as Egress['fetch'];
  return { fn, calls };
}

function sender(fn: Egress['fetch']) {
  return createWebPushSender({
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    subject: 'mailto:admin@fetivi.test',
    fetch: fn,
  });
}

describe('createWebPushSender', () => {
  it('sends the encrypted VAPID request through the given fetch', async () => {
    const { fn, calls } = fakeFetch();
    const sub = subscriber();
    const topic = pushTopic('order:1:proposal:2:notify:order_confirmed');
    const outcome = await sender(fn).send(sub, { title: 'T', body: 'B', url: '/trip' }, { topic });
    expect(outcome).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(sub.endpoint);
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(String(headers.TTL)).toBe('86400');
    expect(headers.Topic).toBe(topic);
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(calls[0]?.init.body).toBeInstanceOf(Uint8Array);
  });

  it('reports a gone subscription', async () => {
    expect(
      await sender(fakeFetch(410).fn).send(
        subscriber(),
        { title: 'T', body: 'B', url: '/' },
        {
          topic: pushTopic('k'),
        },
      ),
    ).toBe('gone');
  });

  it('throws on other failures', async () => {
    await expect(
      sender(fakeFetch(500).fn).send(
        subscriber(),
        { title: 'T', body: 'B', url: '/' },
        {
          topic: pushTopic('k'),
        },
      ),
    ).rejects.toThrow(/500/);
  });
});

describe('push helpers', () => {
  it('allows only https endpoints on the push services', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.test/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('https://push.services.mozilla.com.evil.test/x')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });

  it('makes a 32-character base64url topic', () => {
    expect(pushTopic('a')).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pushTopic('a')).toBe(pushTopic('a'));
    expect(pushTopic('a')).not.toBe(pushTopic('b'));
  });
});

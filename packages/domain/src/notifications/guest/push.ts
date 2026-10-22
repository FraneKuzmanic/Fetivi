import { createHash } from 'node:crypto';
import type { Egress } from '@fetivi/egress';
import { and, eq, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import type { Executor } from '../../db/client';
import { pushSubscriptions } from '../../db/schema/notifications';
import { spaces } from '../../db/schema/spaces';
import { PUSH_HOSTS } from './vocabulary';

// Android web push with VAPID. The library builds the encrypted request; the send goes through
// the caller's egress `fetch` (the library's own sender uses `https.request`, bypassing egress).

export { PUSH_HOSTS } from './vocabulary';

export interface PushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** A same-origin path in the app that receives it. */
  url: string;
}

export interface PushSendOptions {
  topic: string;
  /** RFC 8030 Urgency; 'normal' when left out. */
  urgency?: 'normal' | 'high';
}

export interface PushSender {
  /** 'gone' when the push service no longer knows the subscription (404/410); other failures throw. */
  send(sub: PushKeys, message: PushMessage, options: PushSendOptions): Promise<'sent' | 'gone'>;
}

/** An https endpoint on one of the allowed push services (the guest list unless `hosts` is given). */
export function isAllowedPushEndpoint(url: string, hosts: readonly string[] = PUSH_HOSTS): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return hosts.some((allowed) =>
    allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) : host === allowed,
  );
}

/** The RFC 8030 Topic for a notification key: a retried duplicate replaces an undelivered one. */
export function pushTopic(key: string): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 32);
}

/** Undelivered pushes are dropped after a day. */
export const PUSH_TTL_SECONDS = 86_400;

export class PushSendError extends Error {
  constructor(readonly status: number) {
    super(`push send failed: ${status}`);
    this.name = 'PushSendError';
  }
}

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` contact for the push service. */
  subject: string;
  fetch: Egress['fetch'];
}

export function createWebPushSender(config: WebPushConfig): PushSender {
  return {
    async send(sub, message, { topic, urgency }) {
      const details = webpush.generateRequestDetails(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: config.subject,
            publicKey: config.publicKey,
            privateKey: config.privateKey,
          },
          TTL: PUSH_TTL_SECONDS,
          topic,
          urgency: urgency ?? 'normal',
        },
      );
      const response = await config.fetch(details.endpoint, {
        method: details.method,
        headers: details.headers as Record<string, string>,
        body: new Uint8Array(details.body),
      });
      if (response.status === 404 || response.status === 410) return 'gone';
      if (!response.ok) throw new PushSendError(response.status);
      return 'sent';
    },
  };
}

interface MemoryPush {
  sub: PushKeys;
  message: PushMessage;
  topic: string;
  urgency: 'normal' | 'high';
}

/** Test sender: keeps sent pushes; endpoints in `gone` answer 'gone'. */
export function createMemoryPushSender(): PushSender & {
  readonly sent: MemoryPush[];
  readonly gone: Set<string>;
} {
  const sent: MemoryPush[] = [];
  const gone = new Set<string>();
  return {
    sent,
    gone,
    async send(sub, message, { topic, urgency }) {
      if (gone.has(sub.endpoint)) return 'gone';
      sent.push({ sub, message, topic, urgency: urgency ?? 'normal' });
      return 'sent';
    },
  };
}

/** Stores a subscription; an endpoint already stored (the same device, a new Stay) moves to this space. */
export async function savePushSubscription(
  db: Executor,
  spaceId: string,
  keys: PushKeys,
  now: Date,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ spaceId, ...keys, createdAt: now })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { spaceId, p256dh: keys.p256dh, auth: keys.auth, createdAt: now },
    });
}

export async function deletePushSubscription(db: Executor, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listPushSubscriptions(db: Executor, spaceId: string): Promise<PushKeys[]> {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.spaceId, spaceId));
}

/** Marks the one-time offer answered; the first time is kept. */
export async function recordPushOffer(db: Executor, spaceId: string, now: Date): Promise<void> {
  await db
    .update(spaces)
    .set({ pushOfferedAt: now })
    .where(and(eq(spaces.id, spaceId), isNull(spaces.pushOfferedAt)));
}

export async function pushState(
  db: Executor,
  spaceId: string,
): Promise<{ offered: boolean; subscribed: boolean }> {
  const [space] = await db
    .select({ pushOfferedAt: spaces.pushOfferedAt })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  const subs = await listPushSubscriptions(db, spaceId);
  return { offered: Boolean(space?.pushOfferedAt), subscribed: subs.length > 0 };
}

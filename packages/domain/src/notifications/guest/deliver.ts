import { appendInboxMessage } from '../../conversations/store';
import type { Db, Executor } from '../../db/client';
import { guestNotificationDeliveries } from '../../db/schema/notifications';
import { INBOX_PART_TYPE } from '../../handoff/vocabulary';
import { uuidFrom } from '../../jobs/queue';
import type { Mailer } from '../../mail';
import { tipsUnsubscribeToken, tipsUnsubscribeUrls } from '../../tips/unsubscribe';
import { composeGuestEmail, composeGuestPush } from './compose';
import type { GuestNotifyJobData } from './enqueue';
import { type GuestNotice, loadGuestNotice } from './load';
import { deletePushSubscription, listPushSubscriptions, type PushSender, pushTopic } from './push';
import { CHANNELS_BY_KIND, GUEST_CHANNELS, type GuestChannel, REVIEW_LINKS } from './vocabulary';

export interface GuestNotifyDeps {
  db: Db;
  mailer: Mailer;
  /** Null when VAPID keys are not configured: the push channel is skipped. */
  push: PushSender | null;
  /** The guest app's origin, for the email links. */
  guestOrigin: string;
  /** Signs the daily-tip unsubscribe links; the same value as chat-backend's. */
  guestLinkSecret: string;
  now: () => Date;
}

export type GuestSendOutcome = 'sent' | 'already_sent' | 'skipped';
export type GuestDeliveryResult = Record<GuestChannel, GuestSendOutcome>;

/**
 * Sends one guest notification on each of its channels, once per channel: inbox, then email, then
 * push. Each channel's ledger row and its send share a transaction, so a failed send leaves no
 * row and the job's retry sends it again, while the channels already sent stay sent. The inbox is
 * strictly once (row and message commit together); a lost commit after an email or push is
 * collapsed by the email's idempotency key and the push Topic.
 */
export async function deliverGuestNotification(
  deps: GuestNotifyDeps,
  data: GuestNotifyJobData,
): Promise<GuestDeliveryResult> {
  const result: GuestDeliveryResult = { inbox: 'skipped', email: 'skipped', push: 'skipped' };
  const notice = await loadGuestNotice(deps.db, data, deps.now());
  if (!notice) return result;
  for (const channel of GUEST_CHANNELS) {
    if (!CHANNELS_BY_KIND[notice.kind].includes(channel)) continue;
    result[channel] = await SENDERS[channel](deps, notice);
  }
  return result;
}

/**
 * The `notice` inbox item (`inboxItem` in `@fetivi/ui/payloads`): facts only, worded by the guest
 * app in its current language. No email, phone or codes.
 */
export function noticeInboxData(notice: GuestNotice, now: Date) {
  const { facts } = notice;
  return {
    kind: 'notice' as const,
    notification: notice.kind,
    orderId: notice.orderId,
    offerTitle: facts.offerTitle,
    date: facts.date,
    startTime: facts.startTime,
    checkoutTime: facts.checkoutTime,
    reviewPlatform: facts.reviewPlatform,
    reviewUrl: facts.reviewPlatform ? REVIEW_LINKS[facts.reviewPlatform] : null,
    /** Safety kinds: the source's own words, worded around by the guest app. */
    safety: facts.safety,
    /** Daily tips: the picked record, worded by the guest app. */
    tip: facts.tip,
    at: now.toISOString(),
  };
}

type ChannelSender = (deps: GuestNotifyDeps, notice: GuestNotice) => Promise<GuestSendOutcome>;

const SENDERS: Record<GuestChannel, ChannelSender> = {
  async inbox(deps, notice) {
    const { conversationId } = notice;
    if (!conversationId) return 'skipped';
    const now = deps.now();
    return once(deps.db, notice, 'inbox', now, async (tx) => {
      await appendInboxMessage(tx, {
        conversationId,
        id: uuidFrom(`${notice.key}:inbox`),
        parts: [
          { type: INBOX_PART_TYPE, id: uuidFrom(notice.key), data: noticeInboxData(notice, now) },
        ],
        now,
      });
    });
  },

  async email(deps, notice) {
    const to = notice.email;
    if (!to) return 'skipped';
    // Derived, so a retried job rebuilds a byte-identical body for the idempotency key.
    const unsubscribe =
      notice.kind === 'daily_tip'
        ? tipsUnsubscribeUrls(
            deps.guestOrigin,
            notice.spaceId,
            tipsUnsubscribeToken(deps.guestLinkSecret, notice.spaceId),
          )
        : undefined;
    const message = composeGuestEmail(
      notice.kind,
      notice.facts,
      notice.language,
      deps.guestOrigin,
      unsubscribe,
    );
    return once(deps.db, notice, 'email', deps.now(), () =>
      deps.mailer.send({ to, ...message, idempotencyKey: `${notice.key}:email` }),
    );
  },

  async push(deps, notice) {
    const sender = deps.push;
    if (!sender || !notice.spaceOpen) return 'skipped';
    const subs = await listPushSubscriptions(deps.db, notice.spaceId);
    if (subs.length === 0) return 'skipped';
    const message = composeGuestPush(notice.kind, notice.facts, notice.language);
    const topic = pushTopic(notice.key);
    return once(deps.db, notice, 'push', deps.now(), async (tx) => {
      for (const sub of subs) {
        if ((await sender.send(sub, message, { topic })) === 'gone') {
          await deletePushSubscription(tx, sub.endpoint);
        }
      }
    });
  },
};

/** The ledger row and the send in one transaction; a row already there means sent before. */
async function once(
  db: Db,
  notice: GuestNotice,
  channel: GuestChannel,
  now: Date,
  send: (tx: Executor) => Promise<void>,
): Promise<'sent' | 'already_sent'> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(guestNotificationDeliveries)
      .values({ key: notice.key, channel, kind: notice.kind, spaceId: notice.spaceId, sentAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return 'already_sent';
    await send(tx);
    return 'sent';
  });
}

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { accounts } from '../../db/schema/accounts';
import { handoffMessages } from '../../db/schema/handoff';
import { hostNotificationDeliveries } from '../../db/schema/notifications';
import { properties, units } from '../../db/schema/properties';
import { stays } from '../../db/schema/stays';
import type { Mailer } from '../../mail';
import { type PushMessage, type PushSender, type PushSendOptions, pushTopic } from '../guest/push';
import {
  composeHostDigestEmail,
  composeHostDigestPush,
  composeHostMessageEmail,
  composeHostMessagePush,
  type HostMessageFacts,
} from './compose';
import { hostNotificationKey } from './enqueue';
import { deleteHostPushSubscription, listHostPushSubscriptions } from './push';
import { getHostNotificationSettings } from './settings';
import type { HostChannel } from './vocabulary';

// Host notifications about Host messages (ADR 0008). Each message is notified once, by one path:
// the immediate job or a digest claims it by setting `host_notification_key` where it is null.
// Each channel then sends once through the ledger, as for guests (ADR 0007).

export interface HostNotifyDeps {
  db: Db;
  mailer: Mailer;
  /** Null when VAPID keys are not configured: the push channel is skipped. */
  push: PushSender | null;
  /** The back-office origin, for the email links. */
  webOrigin: string;
  now: () => Date;
}

export type HostSendOutcome = 'sent' | 'already_sent' | 'skipped';
export type HostDeliveryResult = Record<HostChannel, HostSendOutcome>;

const SKIPPED: HostDeliveryResult = { email: 'skipped', push: 'skipped' };

/** A Host message with what the host's email may say, its owner and its claim. */
function factsQuery(db: Executor) {
  return db
    .select({
      id: handoffMessages.id,
      unitName: units.name,
      propertyName: properties.name,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      reason: handoffMessages.reason,
      urgency: handoffMessages.urgency,
      readAt: handoffMessages.readAt,
      hostNotificationKey: handoffMessages.hostNotificationKey,
      hostId: properties.hostId,
    })
    .from(handoffMessages)
    .innerJoin(units, eq(units.id, handoffMessages.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(stays, eq(stays.id, handoffMessages.stayId));
}

function toFacts(row: HostMessageFacts): HostMessageFacts {
  const { id, unitName, propertyName, checkIn, checkout, reason, urgency } = row;
  return { id, unitName, propertyName, checkIn, checkout, reason, urgency };
}

/** The host's address, or null when the account is gone or suspended. */
async function hostEmail(db: Executor, hostId: string): Promise<string | null> {
  const [host] = await db
    .select({ email: accounts.email, suspendedAt: accounts.suspendedAt })
    .from(accounts)
    .where(eq(accounts.id, hostId));
  return host && !host.suspendedAt ? host.email : null;
}

/**
 * The immediate path: one email (and push) for a Host message, unless the host is in Digest mode
 * and the message is normal, which the digest claims later. Urgent messages bypass the digest.
 * The decision uses the host's settings when the job runs.
 */
export async function deliverHostMessageNotification(
  deps: HostNotifyDeps,
  handoffId: string,
): Promise<{ outcome: 'notified' | 'deferred' | 'skipped'; channels: HostDeliveryResult }> {
  const skipped = { outcome: 'skipped' as const, channels: { ...SKIPPED } };
  const key = hostNotificationKey({ kind: 'message', handoffId });
  const [row] = await factsQuery(deps.db).where(eq(handoffMessages.id, handoffId));
  // The host already opened it: nothing to tell them.
  if (!row || row.readAt) return skipped;
  const email = await hostEmail(deps.db, row.hostId);
  if (!email) return skipped;
  const ours = row.hostNotificationKey === key;
  if (!ours && row.urgency === 'normal') {
    const { mode } = await getHostNotificationSettings(deps.db, row.hostId);
    if (mode === 'digest') return { outcome: 'deferred', channels: { ...SKIPPED } };
  }
  const now = deps.now();
  const claimed = await deps.db
    .update(handoffMessages)
    .set({ hostNotificationKey: key, hostNotifiedAt: now })
    .where(
      and(
        eq(handoffMessages.id, handoffId),
        or(
          isNull(handoffMessages.hostNotificationKey),
          eq(handoffMessages.hostNotificationKey, key),
        ),
      ),
    )
    .returning({ id: handoffMessages.id });
  // A digest told the host already.
  if (claimed.length === 0) return skipped;

  const facts = toFacts(row);
  const channels = await send(deps, {
    key,
    hostId: row.hostId,
    email,
    message: composeHostMessageEmail(facts, deps.webOrigin),
    push: composeHostMessagePush(facts),
    urgency: facts.urgency === 'urgent' ? 'high' : 'normal',
  });
  return { outcome: 'notified', channels };
}

/**
 * One digest for a host and slot: claims the host's pending normal messages sent at or before the
 * slot, then sends one email (and push) listing them. A retry finds the key already on its
 * messages and claims nothing more, so it composes the same email for the same idempotency key.
 * A digest enqueued before the host switched to Immediate still sends: its messages were deferred.
 */
export async function deliverHostDigest(
  deps: HostNotifyDeps,
  data: { hostId: string; slot: string },
): Promise<{ outcome: 'notified' | 'skipped'; count: number; channels: HostDeliveryResult }> {
  const skipped = { outcome: 'skipped' as const, count: 0, channels: { ...SKIPPED } };
  const email = await hostEmail(deps.db, data.hostId);
  if (!email) return skipped;
  const key = hostNotificationKey({ kind: 'digest', ...data });
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    // Serialises duplicate runs of one slot, so they claim one member list.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [existing] = await tx
      .select({ id: handoffMessages.id })
      .from(handoffMessages)
      .where(eq(handoffMessages.hostNotificationKey, key))
      .limit(1);
    if (existing) return;
    const pending = tx
      .select({ id: handoffMessages.id })
      .from(handoffMessages)
      .innerJoin(units, eq(units.id, handoffMessages.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(
        and(
          eq(properties.hostId, data.hostId),
          isNull(handoffMessages.hostNotificationKey),
          isNull(handoffMessages.readAt),
          eq(handoffMessages.urgency, 'normal'),
          lte(handoffMessages.sentAt, new Date(data.slot)),
        ),
      );
    await tx
      .update(handoffMessages)
      .set({ hostNotificationKey: key, hostNotifiedAt: now })
      .where(
        and(inArray(handoffMessages.id, pending), isNull(handoffMessages.hostNotificationKey)),
      );
  });

  // Read ones included: the claim fixed the list, so a retry sends the same body.
  const rows = await factsQuery(deps.db)
    .where(eq(handoffMessages.hostNotificationKey, key))
    .orderBy(asc(handoffMessages.sentAt), asc(handoffMessages.id));
  if (rows.length === 0) return skipped;
  const list = rows.map(toFacts);
  const channels = await send(deps, {
    key,
    hostId: data.hostId,
    email,
    message: composeHostDigestEmail(list, deps.webOrigin),
    push: composeHostDigestPush(list),
    urgency: 'normal',
  });
  return { outcome: 'notified', count: list.length, channels };
}

/** Email, then push, each once per key. */
async function send(
  deps: HostNotifyDeps,
  n: {
    key: string;
    hostId: string;
    email: string;
    message: { subject: string; text: string };
    push: PushMessage;
    urgency: NonNullable<PushSendOptions['urgency']>;
  },
): Promise<HostDeliveryResult> {
  const result: HostDeliveryResult = { ...SKIPPED };
  result.email = await once(deps.db, n.key, 'email', n.hostId, deps.now(), () =>
    deps.mailer.send({ to: n.email, ...n.message, idempotencyKey: `${n.key}:email` }),
  );
  const sender = deps.push;
  if (!sender) return result;
  const subs = await listHostPushSubscriptions(deps.db, n.hostId);
  if (subs.length === 0) return result;
  const options = { topic: pushTopic(n.key), urgency: n.urgency };
  result.push = await once(deps.db, n.key, 'push', n.hostId, deps.now(), async (tx) => {
    for (const sub of subs) {
      if ((await sender.send(sub, n.push, options)) === 'gone') {
        await deleteHostPushSubscription(tx, n.hostId, sub.endpoint);
      }
    }
  });
  return result;
}

/** The ledger row and the send in one transaction; a row already there means sent before. */
async function once(
  db: Db,
  key: string,
  channel: HostChannel,
  hostId: string,
  now: Date,
  send: (tx: Executor) => Promise<void>,
): Promise<'sent' | 'already_sent'> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(hostNotificationDeliveries)
      .values({ key, channel, hostId, sentAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return 'already_sent';
    await send(tx);
    return 'sent';
  });
}

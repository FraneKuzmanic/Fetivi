import { and, count, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { hostPushSubscriptions } from '../../db/schema/notifications';
import type { PushKeys } from '../guest/push';

// A host's phones (Home Screen apps). A subscription belongs to the person holding the device, so
// it is keyed by the signed-in account, never by an admin acting as the host.

/** Stores a subscription; an endpoint already stored (a shared device) moves to this account. */
export async function saveHostPushSubscription(
  db: Executor,
  accountId: string,
  keys: PushKeys,
  now: Date,
): Promise<void> {
  await db
    .insert(hostPushSubscriptions)
    .values({ accountId, ...keys, createdAt: now })
    .onConflictDoUpdate({
      target: hostPushSubscriptions.endpoint,
      set: { accountId, p256dh: keys.p256dh, auth: keys.auth, createdAt: now },
    });
}

/** Removes the account's own subscription; another account's endpoint is left alone. */
export async function deleteHostPushSubscription(
  db: Executor,
  accountId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(hostPushSubscriptions)
    .where(
      and(
        eq(hostPushSubscriptions.accountId, accountId),
        eq(hostPushSubscriptions.endpoint, endpoint),
      ),
    );
}

export async function listHostPushSubscriptions(
  db: Executor,
  accountId: string,
): Promise<PushKeys[]> {
  return db
    .select({
      endpoint: hostPushSubscriptions.endpoint,
      p256dh: hostPushSubscriptions.p256dh,
      auth: hostPushSubscriptions.auth,
    })
    .from(hostPushSubscriptions)
    .where(eq(hostPushSubscriptions.accountId, accountId));
}

export async function countHostPushSubscriptions(db: Executor, accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(hostPushSubscriptions)
    .where(eq(hostPushSubscriptions.accountId, accountId));
  return row?.n ?? 0;
}

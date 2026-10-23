import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { accounts } from '../../db/schema/accounts';
import { offers } from '../../db/schema/offers';
import { orders } from '../../db/schema/orders';
import type { Mailer } from '../../mail';
import { orderJobKey } from '../../orders/timers';
import { findHostOrder } from '../../services/host-orders';
import {
  findOrderByLinkToken,
  issueProviderLink,
  providerLinkView,
} from '../../services/provider-link/link';
import { providerLinkUrl } from '../../services/provider-link/token';
import { deliverOnce } from '../deliveries';
import { composeHostOrderEmail } from '../host/order-email';
import { HOST_INBOX_PATH } from '../host/vocabulary';
import { composeProviderConfirmed, composeProviderRequest } from './compose';

export interface NotifyDeps {
  db: Db;
  mailer: Mailer;
  now: () => Date;
  providerLink: { secret: string; baseUrl: string };
  /** The back office, where a host answers Orders on own Offers (38). */
  webOrigin: string;
}

export type SendOutcome = 'sent' | 'already_sent' | 'skipped';

/**
 * Emails the Provider a confirmed Order, or an on-request ask (36), with its per-order link. For a
 * host's own Offer the host account gets it instead, pointing to the inbox (38). Skipped when the
 * Order has moved on: no longer in the status the email is about, or new terms.
 */
export async function sendProviderNotification(
  deps: NotifyDeps,
  job: { orderId: string; proposalId: string; kind: 'provider_confirmed' | 'provider_request' },
): Promise<SendOutcome> {
  // Checked before the link is issued, so a skipped send stores no link hash.
  const [current] = await deps.db
    .select({
      providerId: offers.providerId,
      hostId: offers.hostId,
      status: orders.status,
      proposalId: orders.currentProposalId,
    })
    .from(orders)
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .where(eq(orders.id, job.orderId));
  if (!current) return 'skipped';
  const status = job.kind === 'provider_request' ? 'pending_provider' : 'confirmed';
  if (current.status !== status || current.proposalId !== job.proposalId) return 'skipped';
  if (!current.providerId) {
    return current.hostId ? sendHostNotification(deps, job, current.hostId) : 'skipped';
  }
  const token = await issueProviderLink(deps.db, deps.providerLink.secret, job.orderId);
  const found = await findOrderByLinkToken(deps.db, token);
  if (!found?.provider) return 'skipped';
  const view = providerLinkView(found);
  const { email } = found.provider;
  const input = {
    language: view.language,
    providerName: found.provider.name,
    offerTitle: view.offerTitle,
    date: view.date,
    startTime: view.startTime,
    quantity: view.quantity,
    priceUnit: view.priceUnit,
    guest: view.guest,
    link: providerLinkUrl(deps.providerLink.baseUrl, token),
  };
  let message: ReturnType<typeof composeProviderConfirmed>;
  if (job.kind === 'provider_request') {
    // The machine stores the deadline with the ask; without it the email would mislead.
    if (!view.respondBy) throw new Error(`Order ${job.orderId} waits with no response deadline`);
    message = composeProviderRequest({
      ...input,
      respondBy: view.respondBy,
      priceMinor: view.priceMinor,
      currency: view.currency,
    });
  } else {
    message = composeProviderConfirmed(input);
  }
  return deliverOnce(deps.db, job, deps.now(), () =>
    deps.mailer.send({
      to: email,
      ...message,
      idempotencyKey: orderJobKey(job.orderId, job.proposalId, `notify:${job.kind}`),
    }),
  );
}

type NotifyJob = Parameters<typeof sendProviderNotification>[1];

/** The host plays the Provider of their own Offer (ADR 0016): an email to the account, no link token. */
async function sendHostNotification(
  deps: NotifyDeps,
  job: NotifyJob,
  hostId: string,
): Promise<SendOutcome> {
  const [host] = await deps.db
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, hostId));
  const found = await findHostOrder(deps.db, hostId, job.orderId);
  if (!host || !found) return 'skipped';
  const view = providerLinkView(found);
  if (job.kind === 'provider_request' && !view.respondBy) {
    throw new Error(`Order ${job.orderId} waits with no response deadline`);
  }
  const message = composeHostOrderEmail({
    kind: job.kind,
    offerTitle: view.offerTitle,
    date: view.date,
    startTime: view.startTime,
    quantity: view.quantity,
    priceUnit: view.priceUnit,
    guest: view.guest,
    respondBy: view.respondBy,
    priceMinor: view.priceMinor,
    currency: view.currency,
    inboxUrl: `${deps.webOrigin}${HOST_INBOX_PATH}`,
  });
  return deliverOnce(deps.db, job, deps.now(), () =>
    deps.mailer.send({
      to: host.email,
      ...message,
      idempotencyKey: orderJobKey(job.orderId, job.proposalId, `notify:${job.kind}`),
    }),
  );
}

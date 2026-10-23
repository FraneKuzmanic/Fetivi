import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { offers } from '../../db/schema/offers';
import { orders } from '../../db/schema/orders';
import type { Mailer } from '../../mail';
import { orderJobKey } from '../../orders/timers';
import {
  findOrderByLinkToken,
  issueProviderLink,
  providerLinkView,
} from '../../services/provider-link/link';
import { providerLinkUrl } from '../../services/provider-link/token';
import { deliverOnce } from '../deliveries';
import { composeProviderConfirmed, composeProviderRequest } from './compose';

export interface NotifyDeps {
  db: Db;
  mailer: Mailer;
  now: () => Date;
  providerLink: { secret: string; baseUrl: string };
}

export type SendOutcome = 'sent' | 'already_sent' | 'skipped';

/**
 * Emails the Provider a confirmed Order, or an on-request ask (36), with its per-order link.
 * Skipped for a host's own Offer (host inbox, 23/38), and when the Order has moved on: no longer
 * in the status the email is about, or new terms.
 */
export async function sendProviderNotification(
  deps: NotifyDeps,
  job: { orderId: string; proposalId: string; kind: 'provider_confirmed' | 'provider_request' },
): Promise<SendOutcome> {
  // Checked before the link is issued, so a skipped send stores no link hash.
  const [current] = await deps.db
    .select({
      providerId: offers.providerId,
      status: orders.status,
      proposalId: orders.currentProposalId,
    })
    .from(orders)
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .where(eq(orders.id, job.orderId));
  if (!current?.providerId) return 'skipped';
  const status = job.kind === 'provider_request' ? 'pending_provider' : 'confirmed';
  if (current.status !== status || current.proposalId !== job.proposalId) return 'skipped';
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
  const message =
    job.kind === 'provider_request' && view.respondBy
      ? composeProviderRequest({
          ...input,
          respondBy: view.respondBy,
          priceMinor: view.priceMinor,
          currency: view.currency,
        })
      : composeProviderConfirmed(input);
  return deliverOnce(deps.db, job, deps.now(), () =>
    deps.mailer.send({
      to: email,
      ...message,
      idempotencyKey: orderJobKey(job.orderId, job.proposalId, `notify:${job.kind}`),
    }),
  );
}

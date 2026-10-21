import { asc, eq } from 'drizzle-orm';
import { accounts } from '../db/schema/accounts';
import { offers, providers } from '../db/schema/offers';
import { orderProposals, orders } from '../db/schema/orders';
import { orderJobKey } from '../orders/timers';
import { deliverOnce } from './deliveries';
import { formatCivilDate } from './provider/compose';
import type { NotifyDeps, SendOutcome } from './provider/send';

/**
 * Emails every admin that a Provider tapped Can't fulfil, in English (the admin UI's language).
 * Order facts only, no guest contact details. One delivery for the whole kind.
 */
export async function sendAdminAlert(
  deps: Pick<NotifyDeps, 'db' | 'mailer' | 'now'>,
  job: { orderId: string; proposalId: string; kind: 'admin_provider_cancelled' },
): Promise<SendOutcome> {
  const admins = await deps.db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(eq(accounts.role, 'admin'))
    .orderBy(asc(accounts.email));
  const [row] = await deps.db
    .select({
      offerTitle: offers.title,
      providerName: providers.name,
      date: orderProposals.date,
      quantity: orderProposals.quantity,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .where(eq(orders.id, job.orderId));
  if (admins.length === 0 || !row) return 'skipped';
  const subject = `Provider can't fulfil: ${row.offerTitle}, ${formatCivilDate(row.date, 'en')}`;
  const text = [
    `${row.providerName ?? 'The Provider'} can't fulfil this order. It is cancelled and the seats are back.`,
    '',
    `Offer: ${row.offerTitle}`,
    `Date: ${formatCivilDate(row.date, 'en')}`,
    `Quantity: ${row.quantity}`,
    `Order: ${job.orderId}`,
    '',
    'Contact the guest about an alternative.',
  ].join('\n');
  const key = orderJobKey(job.orderId, job.proposalId, `notify:${job.kind}`);
  return deliverOnce(deps.db, job, deps.now(), async () => {
    for (const admin of admins) {
      await deps.mailer.send({
        to: admin.email,
        subject,
        text,
        idempotencyKey: `${key}:${admin.id}`,
      });
    }
  });
}

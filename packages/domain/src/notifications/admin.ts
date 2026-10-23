import { and, asc, eq } from 'drizzle-orm';
import { accounts } from '../db/schema/accounts';
import { offers, providers } from '../db/schema/offers';
import { orderEvents, orderProposals, orders } from '../db/schema/orders';
import { orderJobKey } from '../orders/timers';
import { deliverOnce } from './deliveries';
import { formatCivilDate } from './provider/compose';
import type { NotifyDeps, SendOutcome } from './provider/send';

/**
 * Emails every admin about an Order, in English (the admin UI's language): a Provider tapped
 * Can't fulfil, or a pay-online Order's payment needs a human (the reason is the note of the
 * flagging OrderEvent the job names). Order facts only, no guest contact details. One delivery
 * per kind, and per flagging OrderEvent for a payment alert.
 */
export async function sendAdminAlert(
  deps: Pick<NotifyDeps, 'db' | 'mailer' | 'now'>,
  job: {
    orderId: string;
    proposalId: string;
    kind: 'admin_provider_cancelled' | 'admin_payment_attention';
    eventId?: number;
  },
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
  const date = formatCivilDate(row.date, 'en');
  let subject: string;
  let text: string;
  if (job.kind === 'admin_payment_attention') {
    const [flagged] =
      job.eventId === undefined
        ? []
        : await deps.db
            .select({ note: orderEvents.note })
            .from(orderEvents)
            .where(and(eq(orderEvents.orderId, job.orderId), eq(orderEvents.id, job.eventId)));
    subject = `Payment needs a look: ${row.offerTitle}, ${date}`;
    text = [
      `Order ${job.orderId} (${row.offerTitle}, ${date}) needs a look: ${flagged?.note ?? 'the payment needs attention'}.`,
      '',
      `Provider: ${row.providerName ?? 'unknown'}`,
      `Quantity: ${row.quantity}`,
      '',
      "Check it in Stripe, on the Provider's connected account.",
    ].join('\n');
  } else {
    subject = `Provider can't fulfil: ${row.offerTitle}, ${date}`;
    text = [
      `${row.providerName ?? 'The Provider'} can't fulfil this order. It is cancelled and the seats are back.`,
      '',
      `Offer: ${row.offerTitle}`,
      `Date: ${date}`,
      `Quantity: ${row.quantity}`,
      `Order: ${job.orderId}`,
      '',
      'Contact the guest about an alternative.',
    ].join('\n');
  }
  const key = orderJobKey(
    job.orderId,
    job.proposalId,
    job.eventId === undefined ? `notify:${job.kind}` : `notify:${job.kind}:${job.eventId}`,
  );
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

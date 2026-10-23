import { and, asc, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { accounts } from '../db/schema/accounts';
import { destinations } from '../db/schema/catalog';
import { offers, providers } from '../db/schema/offers';
import { orderEvents, orderProposals, orders } from '../db/schema/orders';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import { orderJobKey } from '../orders/timers';
import { deliverOnce } from './deliveries';
import { formatCivilDate } from './provider/compose';
import type { NotifyDeps, SendOutcome } from './provider/send';

/**
 * Emails every admin about an Order, in English (the admin UI's language): a Provider tapped
 * Can't fulfil, a Provider missed an on-request response window (36; with the Provider's contact
 * details, so the admin can phone them), or a pay-online Order's payment needs a human (the
 * reason is the note of the flagging OrderEvent the job names). Order facts only, no guest
 * contact details. One delivery per kind, and per flagging OrderEvent for a payment alert. With
 * the back-office origin, the email links the admin Order page.
 */
export async function sendAdminAlert(
  deps: Pick<NotifyDeps, 'db' | 'mailer' | 'now'> & { webOrigin?: string },
  job: {
    orderId: string;
    proposalId: string;
    kind: 'admin_provider_cancelled' | 'admin_payment_attention' | 'admin_window_missed';
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
      providerEmail: providers.email,
      providerPhone: providers.whatsappPhone,
      date: orderProposals.date,
      quantity: orderProposals.quantity,
      responseDueAt: orderProposals.responseDueAt,
      status: orders.status,
      zone: destinations.timezone,
      propertyZone: properties.timezone,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .leftJoin(destinations, eq(destinations.id, offers.destinationId))
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(orders.id, job.orderId));
  if (admins.length === 0 || !row) return 'skipped';
  // The Provider answered (or the admin recorded it) before the email went out.
  if (job.kind === 'admin_window_missed' && row.status !== 'pending_provider') return 'skipped';
  const date = formatCivilDate(row.date, 'en');
  const open = deps.webOrigin ? [`Open it: ${deps.webOrigin}/admin/orders/${job.orderId}`] : [];
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
      ...open,
    ].join('\n');
  } else if (job.kind === 'admin_window_missed') {
    const due = row.responseDueAt
      ? DateTime.fromJSDate(row.responseDueAt, { zone: row.zone ?? row.propertyZone }).toFormat(
          'd MMM yyyy HH:mm',
        )
      : 'unknown';
    subject = `Provider hasn't answered: ${row.offerTitle}, ${date}`;
    text = [
      `${row.providerName ?? 'The Provider'} hasn't answered this request. The answer was due ${due}.`,
      '',
      `Offer: ${row.offerTitle}`,
      `Date: ${date}`,
      `Quantity: ${row.quantity}`,
      `Order: ${job.orderId}`,
      '',
      `Provider email: ${row.providerEmail ?? 'unknown'}`,
      `Provider phone: ${row.providerPhone ?? 'unknown'}`,
      '',
      'Phone the Provider and record their answer on the Order page.',
      ...open,
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
      ...open,
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

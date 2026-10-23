import { DateTime } from 'luxon';
import type { PriceUnit } from '../../offers/vocabulary';
import type { CivilDate } from '../../time';
import { formatCivilDate, type GuestFields } from '../provider/compose';

// The host's email about an Order on one of their own services (38): plain English like every
// host email, and no per-order link: the host answers in the back-office inbox.

export interface HostOrderEmailInput {
  kind: 'provider_request' | 'provider_confirmed';
  offerTitle: string;
  date: CivilDate;
  /** 'HH:mm' in the property's zone; null when the Order has no start time. */
  startTime: string | null;
  quantity: number;
  priceUnit: PriceUnit;
  guest: GuestFields;
  /** 'YYYY-MM-DDTHH:mm' in the property's zone; requests only. */
  respondBy: string | null;
  /** The Order's total; null for a request-kind Order before the host names it. */
  priceMinor: number | null;
  currency: string;
  inboxUrl: string;
}

const QUANTITY_LABELS: Record<PriceUnit, string> = {
  person: 'Persons',
  group: 'Groups',
  item: 'Quantity',
};

export function composeHostOrderEmail(input: HostOrderEmailInput): {
  subject: string;
  text: string;
} {
  const request = input.kind === 'provider_request';
  const at = input.respondBy
    ? DateTime.fromISO(input.respondBy, { locale: 'en' }).toFormat('d MMM yyyy HH:mm')
    : null;
  const price =
    input.priceMinor === null
      ? []
      : [
          `Price: ${new Intl.NumberFormat('en', { style: 'currency', currency: input.currency }).format(input.priceMinor / 100)}`,
        ];
  return {
    subject: `${request ? 'New request' : 'New order'}: ${input.offerTitle}`,
    text: [
      request
        ? `A guest asked for ${input.offerTitle}.${at ? ` Please answer by ${at} in your Fetivi inbox.` : ''}`
        : `A guest ordered ${input.offerTitle}.`,
      '',
      `Date: ${formatCivilDate(input.date, 'en')}`,
      ...(input.startTime ? [`Time: ${input.startTime}`] : []),
      `${QUANTITY_LABELS[input.priceUnit]}: ${input.quantity}`,
      ...price,
      ...(input.guest.name ? [`Guest: ${input.guest.name}`] : []),
      ...(input.guest.phone ? [`Guest phone: ${input.guest.phone}`] : []),
      '',
      request
        ? `Accept, decline or suggest another time: ${input.inboxUrl}`
        : `Open your inbox to confirm you got it: ${input.inboxUrl}`,
      '',
      'Fetivi takes no commission on your own services.',
    ].join('\n'),
  };
}

import { DateTime } from 'luxon';
import type { PriceUnit } from '../../offers/vocabulary';
import type { BackofficeLanguage } from '../../property/vocabulary';
import type { CivilDate } from '../../time';
import { formatCivilDate, type GuestFields } from '../provider/compose';
import { HOST_COPY } from './copy';

// The host's email about an Order on one of their own services (38), in the host's back-office
// language (ticket 53), and no per-order link: the host answers in the back-office inbox.

export interface HostOrderEmailInput {
  kind: 'provider_request' | 'provider_confirmed';
  language: BackofficeLanguage;
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
  /** The Order waits for the host's Got it; an accepted request asks nothing more. */
  acknowledge: boolean;
  inboxUrl: string;
}

export function composeHostOrderEmail(input: HostOrderEmailInput): {
  subject: string;
  text: string;
} {
  const copy = HOST_COPY[input.language];
  const o = copy.order;
  const request = input.kind === 'provider_request';
  const at = input.respondBy
    ? DateTime.fromISO(input.respondBy, { locale: input.language }).toFormat(copy.dateTimeFormat)
    : null;
  const price =
    input.priceMinor === null
      ? []
      : [
          `${o.price}: ${new Intl.NumberFormat(copy.numberLocale, { style: 'currency', currency: input.currency }).format(input.priceMinor / 100)}`,
        ];
  return {
    subject: request ? o.subjectRequest(input.offerTitle) : o.subjectOrder(input.offerTitle),
    text: [
      request
        ? at
          ? o.askedAnswerBy(input.offerTitle, at)
          : o.asked(input.offerTitle)
        : o.ordered(input.offerTitle),
      '',
      `${o.date}: ${formatCivilDate(input.date, input.language)}`,
      ...(input.startTime ? [`${o.time}: ${input.startTime}`] : []),
      `${o.quantity[input.priceUnit]}: ${input.quantity}`,
      ...price,
      ...(input.guest.name ? [`${o.guest}: ${input.guest.name}`] : []),
      ...(input.guest.phone ? [`${o.guestPhone}: ${input.guest.phone}`] : []),
      '',
      request
        ? o.respond(input.inboxUrl)
        : input.acknowledge
          ? o.acknowledge(input.inboxUrl)
          : o.see(input.inboxUrl),
      '',
      o.noCommission,
    ].join('\n'),
  };
}

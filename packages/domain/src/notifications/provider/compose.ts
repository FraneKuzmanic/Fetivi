import { DateTime } from 'luxon';
import type { ContactFields, PriceUnit, ProviderLanguage } from '../../offers/vocabulary';
import type { CivilDate } from '../../time';

// The Provider's order email, as plain text in the Provider's language. Pure: the caller loads
// the Order and builds the link.

export interface GuestFields {
  name?: string;
  phone?: string;
}

/** Only the guest details the Offer shares with its Provider. The email is never shared. */
export function guestFieldsFor(
  contactFields: ContactFields,
  guest: { guestName: string | null; guestPhone: string | null },
): GuestFields {
  const fields: GuestFields = {};
  if ((contactFields === 'name' || contactFields === 'name_and_phone') && guest.guestName) {
    fields.name = guest.guestName;
  }
  if ((contactFields === 'phone' || contactFields === 'name_and_phone') && guest.guestPhone) {
    fields.phone = guest.guestPhone;
  }
  return fields;
}

export interface ProviderConfirmedInput {
  language: ProviderLanguage;
  providerName: string;
  offerTitle: string;
  date: CivilDate;
  /** 'HH:mm' in the Offer's zone; null when the Offer has no start time. */
  startTime: string | null;
  quantity: number;
  priceUnit: PriceUnit;
  guest: GuestFields;
  link: string;
}

const STRINGS = {
  hr: {
    dateFormat: 'd.M.yyyy.',
    subject: 'Nova narudžba',
    greeting: 'Poštovani',
    intro: 'Imate novu potvrđenu narudžbu.',
    offer: 'Ponuda',
    date: 'Datum',
    time: 'Vrijeme',
    /** The quantity's label per price unit; the value is the bare number. */
    quantity: { person: 'Broj osoba', group: 'Broj grupa', item: 'Količina' },
    guestName: 'Gost',
    guestPhone: 'Telefon gosta',
    action: 'Otvorite poveznicu za potvrdu primitka ili ako ne možete izvršiti narudžbu.',
  },
  en: {
    dateFormat: 'd MMM yyyy',
    subject: 'New order',
    greeting: 'Hello',
    intro: 'You have a new confirmed order.',
    offer: 'Offer',
    date: 'Date',
    time: 'Time',
    /** The quantity's label per price unit; the value is the bare number. */
    quantity: { person: 'Persons', group: 'Groups', item: 'Quantity' },
    guestName: 'Guest',
    guestPhone: 'Guest phone',
    action: "Open the link to acknowledge it, or to tell us you can't fulfil it.",
  },
} as const;

export function formatCivilDate(date: CivilDate, language: ProviderLanguage): string {
  return DateTime.fromISO(date, { locale: language }).toFormat(STRINGS[language].dateFormat);
}

export function composeProviderConfirmed(input: ProviderConfirmedInput): {
  subject: string;
  text: string;
} {
  const s = STRINGS[input.language];
  const date = formatCivilDate(input.date, input.language);
  const lines = [
    `${s.greeting} ${input.providerName},`,
    '',
    s.intro,
    '',
    `${s.offer}: ${input.offerTitle}`,
    `${s.date}: ${date}`,
    ...(input.startTime ? [`${s.time}: ${input.startTime}`] : []),
    `${s.quantity[input.priceUnit]}: ${input.quantity}`,
    ...(input.guest.name ? [`${s.guestName}: ${input.guest.name}`] : []),
    ...(input.guest.phone ? [`${s.guestPhone}: ${input.guest.phone}`] : []),
    '',
    s.action,
    input.link,
    '',
    'Fetivi',
  ];
  return { subject: `${s.subject}: ${input.offerTitle}, ${date}`, text: lines.join('\n') };
}

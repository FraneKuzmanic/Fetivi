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
    quantity: {
      person: 'Broj osoba',
      group: 'Broj grupa',
      item: 'Količina',
      litre: 'Količina (l)',
      kilogram: 'Količina (kg)',
      hour: 'Broj sati',
      day: 'Broj dana',
    },
    guestName: 'Gost',
    guestPhone: 'Telefon gosta',
    action: 'Otvorite poveznicu za potvrdu primitka ili ako ne možete izvršiti narudžbu.',
    request: {
      subject: 'Novi upit',
      intro: 'Imate novi upit koji čeka vaš odgovor.',
      respondBy: (at: string) => `Molimo odgovorite do ${at}.`,
      price: 'Cijena',
      action: 'Otvorite poveznicu da prihvatite, odbijete ili predložite drugo vrijeme.',
    },
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
    quantity: {
      person: 'Persons',
      group: 'Groups',
      item: 'Quantity',
      litre: 'Litres',
      kilogram: 'Kilograms',
      hour: 'Hours',
      day: 'Days',
    },
    guestName: 'Guest',
    guestPhone: 'Guest phone',
    action: "Open the link to acknowledge it, or to tell us you can't fulfil it.",
    request: {
      subject: 'New request',
      intro: 'You have a new request waiting for your answer.',
      respondBy: (at: string) => `Please answer by ${at}.`,
      price: 'Price',
      action: 'Open the link to accept, decline or suggest another time.',
    },
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
  return compose(input, s.subject, [s.intro], [], s.action);
}

export interface ProviderRequestInput extends ProviderConfirmedInput {
  /** 'YYYY-MM-DDTHH:mm' in the Offer's zone: when the answer is due. */
  respondBy: string;
  /** The Order's total; null for a request-kind Offer that has no price yet. */
  priceMinor: number | null;
  currency: string;
}

/** The on-request ask (36): the Provider answers on the link before `respondBy`. */
export function composeProviderRequest(input: ProviderRequestInput): {
  subject: string;
  text: string;
} {
  const s = STRINGS[input.language];
  const at = DateTime.fromISO(input.respondBy, { locale: input.language }).toFormat(
    `${s.dateFormat} HH:mm`,
  );
  const price =
    input.priceMinor === null
      ? []
      : [
          `${s.request.price}: ${new Intl.NumberFormat(input.language, { style: 'currency', currency: input.currency }).format(input.priceMinor / 100)}`,
        ];
  return compose(
    input,
    s.request.subject,
    [s.request.intro, s.request.respondBy(at)],
    price,
    s.request.action,
  );
}

function compose(
  input: ProviderConfirmedInput,
  subject: string,
  intro: string[],
  extra: string[],
  action: string,
): { subject: string; text: string } {
  const s = STRINGS[input.language];
  const date = formatCivilDate(input.date, input.language);
  const lines = [
    `${s.greeting} ${input.providerName},`,
    '',
    ...intro,
    '',
    `${s.offer}: ${input.offerTitle}`,
    `${s.date}: ${date}`,
    ...(input.startTime ? [`${s.time}: ${input.startTime}`] : []),
    `${s.quantity[input.priceUnit]}: ${input.quantity}`,
    ...extra,
    ...(input.guest.name ? [`${s.guestName}: ${input.guest.name}`] : []),
    ...(input.guest.phone ? [`${s.guestPhone}: ${input.guest.phone}`] : []),
    '',
    action,
    input.link,
    '',
    'Fetivi',
  ];
  return { subject: `${subject}: ${input.offerTitle}, ${date}`, text: lines.join('\n') };
}

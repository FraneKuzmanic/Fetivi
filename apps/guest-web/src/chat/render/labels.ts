import type { PriceUnit } from '@fetivi/domain/offer-vocabulary';
import type { OrderStatus, PaymentStatus } from '@fetivi/domain/order-vocabulary';
import type {
  AvailabilityPickerLabels,
  ChoiceCardLabels,
  ConfirmationCardLabels,
  PlaceLabels,
  ReceiptLabels,
} from '@fetivi/ui';
import type { TFunction } from 'i18next';

/** The place components' strings in the interface language (numbers and months formatted for it). */
export function placeLabels(t: TFunction, language: string): PlaceLabels {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const month = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' });
  return {
    places: t('components.places'),
    viewCards: t('components.viewCards'),
    viewMap: t('components.viewMap'),
    expandMap: t('components.expandMap'),
    closeMap: t('components.closeMap'),
    mapUnavailable: t('components.mapUnavailable'),
    photoOf: (title) => t('components.photoOf', { title }),
    photoCredit: (credit) => t('components.photoCredit', { credit }),
    km: (distance) => t('components.km', { distance: number.format(distance) }),
    minutes: (minutes) => t('components.minutes', { minutes: number.format(minutes) }),
    lastChecked: (verifiedAt) =>
      t('components.lastChecked', { month: month.format(new Date(verifiedAt)) }),
    unverified: t('components.unverified'),
    hostPick: t('components.hostPick'),
    save: t('components.save'),
    saved: t('components.saved'),
  };
}

export const choiceLabels = (t: TFunction): ChoiceCardLabels => ({
  send: t('components.send'),
  somethingElse: t('components.somethingElse'),
});

const ORDER_STATUS_KEYS = {
  awaiting_confirmation: 'booking.statusAwaiting',
  confirming: 'booking.statusConfirming',
  pending_provider: 'booking.statusPending',
  confirmed: 'booking.statusConfirmed',
  declined: 'booking.statusDeclined',
  expired: 'booking.statusExpired',
  failed: 'booking.statusFailed',
  cancelled: 'booking.statusCancelled',
  completed: 'booking.statusCompleted',
} as const satisfies Record<OrderStatus, string>;

const PAYMENT_STATUS_KEYS = {
  none: 'booking.paymentNone',
  authorized: 'booking.paymentAuthorized',
  captured: 'booking.paymentCaptured',
  voided: 'booking.paymentVoided',
  refund_pending: 'booking.paymentRefundPending',
  refunded: 'booking.paymentRefunded',
  failed: 'booking.paymentFailed',
} as const satisfies Record<PaymentStatus, string>;

const UNIT_KEYS = {
  person: 'booking.perPerson',
  group: 'booking.perGroup',
  item: 'booking.perItem',
} as const satisfies Record<PriceUnit, string>;

/** Dates, times and money of a booking in the interface language. */
function bookingFormat(t: TFunction, language: string) {
  // A civil date at UTC noon, formatted in UTC: no day shift in any zone.
  const day = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });
  const clock = new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone: 'UTC' });
  const date = (civil: string) => day.format(new Date(`${civil}T12:00:00Z`));
  /** 'YYYY-MM-DDTHH:mm' at the property, shown as that wall-clock time. */
  const time = (local: string) => clock.format(new Date(`${local}:00Z`));
  return {
    date,
    time,
    dateTime: (civil: string, local: string | null) =>
      local ? t('booking.dateAt', { date: date(civil), time: time(local) }) : date(civil),
    price: (minor: number | null, currency: string) =>
      minor === null
        ? t('booking.priceByProvider')
        : new Intl.NumberFormat(language, { style: 'currency', currency }).format(minor / 100),
  };
}

export function confirmationLabels(t: TFunction, language: string): ConfirmationCardLabels {
  const f = bookingFormat(t, language);
  return {
    heading: t('booking.heading'),
    offer: t('booking.offer'),
    when: t('booking.when'),
    quantity: t('booking.quantity'),
    total: t('booking.total'),
    payment: t('booking.payment'),
    cancellation: t('booking.cancellation'),
    dateTime: f.dateTime,
    quantityOf: (count, unit) => t(UNIT_KEYS[unit], { count }),
    price: f.price,
    paymentMode: (mode) => t(mode === 'direct' ? 'booking.payDirect' : 'booking.payOnline'),
    field: { email: t('booking.email'), name: t('booking.name'), phone: t('booking.phone') },
    invalid: {
      email: t('booking.invalidEmail'),
      name: t('booking.invalidName'),
      phone: t('booking.invalidPhone'),
    },
    note: t('booking.note'),
    confirm: t('booking.confirm'),
    cancel: t('booking.cancel'),
    sending: t('booking.sending'),
  };
}

export function pickerLabels(t: TFunction, language: string): AvailabilityPickerLabels {
  const f = bookingFormat(t, language);
  return {
    heading: (date) => t('booking.pickHeading', { date: f.date(date) }),
    time: (local) => (local ? f.time(local) : t('booking.anyTime')),
    placesLeft: (count) => t('booking.placesLeft', { count }),
  };
}

/** What the guest's pick says in the chat, in their words. */
export function pickedText(t: TFunction, language: string, date: string, local: string | null) {
  const f = bookingFormat(t, language);
  return local
    ? t('booking.pickStart', { time: f.time(local), date: f.date(date) })
    : t('booking.pickDay', { date: f.date(date) });
}

export function receiptLabels(t: TFunction, language: string): ReceiptLabels {
  const f = bookingFormat(t, language);
  return {
    when: t('booking.when'),
    quantity: t('booking.quantity'),
    total: t('booking.total'),
    booking: t('booking.bookingStatus'),
    payment: t('booking.payment'),
    reference: t('booking.reference'),
    dateTime: f.dateTime,
    price: f.price,
    orderStatus: (status) => t(ORDER_STATUS_KEYS[status]),
    // A pay-direct Order has no payment here: the guest pays the provider.
    paymentStatus: (status, mode) =>
      status === 'none' && mode === 'direct'
        ? t('booking.payDirect')
        : t(PAYMENT_STATUS_KEYS[status]),
  };
}

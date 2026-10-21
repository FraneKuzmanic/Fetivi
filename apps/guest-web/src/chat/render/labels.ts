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
  awaiting_confirmation: 'order.statusAwaiting',
  confirming: 'order.statusConfirming',
  pending_provider: 'order.statusPending',
  confirmed: 'order.statusConfirmed',
  declined: 'order.statusDeclined',
  expired: 'order.statusExpired',
  failed: 'order.statusFailed',
  cancelled: 'order.statusCancelled',
  completed: 'order.statusCompleted',
} as const satisfies Record<OrderStatus, string>;

const PAYMENT_STATUS_KEYS = {
  none: 'order.paymentNone',
  authorized: 'order.paymentAuthorized',
  captured: 'order.paymentCaptured',
  voided: 'order.paymentVoided',
  refund_pending: 'order.paymentRefundPending',
  refunded: 'order.paymentRefunded',
  failed: 'order.paymentFailed',
} as const satisfies Record<PaymentStatus, string>;

// The quantity's heading names its unit, so the count needs no plural forms.
const UNIT_KEYS = {
  person: 'order.people',
  group: 'order.groups',
  item: 'order.items',
} as const satisfies Record<PriceUnit, string>;

/** Dates, times and money of an Order in the interface language. */
function orderFormat(t: TFunction, language: string) {
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
      local ? t('order.dateAt', { date: date(civil), time: time(local) }) : date(civil),
    price: (minor: number | null, currency: string) =>
      minor === null
        ? t('order.priceByProvider')
        : new Intl.NumberFormat(language, { style: 'currency', currency }).format(minor / 100),
  };
}

export function confirmationLabels(t: TFunction, language: string): ConfirmationCardLabels {
  const f = orderFormat(t, language);
  return {
    heading: t('order.heading'),
    offer: t('order.offer'),
    when: t('order.when'),
    quantity: (unit) => t(UNIT_KEYS[unit]),
    total: t('order.total'),
    payment: t('order.payment'),
    cancellation: t('order.cancellation'),
    dateTime: f.dateTime,
    price: f.price,
    paymentMode: (mode) => t(mode === 'direct' ? 'order.payDirect' : 'order.payOnline'),
    field: { email: t('order.email'), name: t('order.name'), phone: t('order.phone') },
    invalid: {
      email: t('order.invalidEmail'),
      name: t('order.invalidName'),
      phone: t('order.invalidPhone'),
    },
    note: t('order.note'),
    confirm: t('order.confirm'),
    cancel: t('order.cancel'),
    sending: t('order.sending'),
  };
}

export function pickerLabels(t: TFunction, language: string): AvailabilityPickerLabels {
  const f = orderFormat(t, language);
  return {
    heading: (date) => t('order.pickHeading', { date: f.date(date) }),
    time: (local) => (local ? f.time(local) : t('order.anyTime')),
    placesLeft: (count) => t('order.placesLeft', { count }),
  };
}

/** What the guest's pick says in the chat, in their words. */
export function pickedText(t: TFunction, language: string, date: string, local: string | null) {
  const f = orderFormat(t, language);
  return local
    ? t('order.pickStart', { time: f.time(local), date: f.date(date) })
    : t('order.pickDay', { date: f.date(date) });
}

export function receiptLabels(t: TFunction, language: string): ReceiptLabels {
  const f = orderFormat(t, language);
  return {
    when: t('order.when'),
    quantity: (unit) => t(UNIT_KEYS[unit]),
    total: t('order.total'),
    status: t('order.orderStatus'),
    payment: t('order.payment'),
    reference: t('order.reference'),
    dateTime: f.dateTime,
    price: f.price,
    orderStatus: (status) => t(ORDER_STATUS_KEYS[status]),
    // A pay-direct Order has no payment here: the guest pays the provider.
    paymentStatus: (status, mode) =>
      status === 'none' && mode === 'direct'
        ? t('order.payDirect')
        : t(PAYMENT_STATUS_KEYS[status]),
  };
}

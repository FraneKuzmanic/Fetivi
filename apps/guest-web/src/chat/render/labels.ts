import { ferryLineLabel, lineOperator } from '@fetivi/domain/alerts-vocabulary';
import type { PriceUnit } from '@fetivi/domain/offer-vocabulary';
import type { OrderStatus, PaymentStatus } from '@fetivi/domain/order-vocabulary';
import { DHMZ_URL, type WarningLevel } from '@fetivi/domain/weather-vocabulary';
import type {
  AvailabilityPickerLabels,
  ChoiceCardLabels,
  ConfirmationCardLabels,
  DayPlanLabels,
  HostDraftLabels,
  HostSentLabels,
  PlaceLabels,
  ReceiptLabels,
  WeatherLabels,
} from '@fetivi/ui';
import type { InboxItem } from '@fetivi/ui/payloads';
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

/** The day plan's strings; a day reads "Tuesday 15 July" in the interface language. */
export function planLabels(t: TFunction, language: string): DayPlanLabels {
  const day = new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return {
    day: (date) => day.format(new Date(`${date}T12:00:00Z`)),
    today: t('trip.today'),
    anyTime: t('trip.anyTime'),
    nothingPlanned: t('trip.nothingPlanned'),
    booked: t('trip.booked'),
    orderStatus: (status) => t(ORDER_STATUS_KEYS[status]),
    ask: (title) => t('trip.ask', { title }),
    askShort: t('trip.askShort'),
    plan: t('trip.planLabel'),
  };
}

/** The WHO UV index bands. */
const uvBand = (value: number) => {
  const v = Math.round(value);
  return v <= 2 ? 'low' : v <= 5 ? 'moderate' : v <= 7 ? 'high' : v <= 10 ? 'very_high' : 'extreme';
};

/** The weather card's strings; numbers, days and warning times in the interface language. */
export function weatherLabels(t: TFunction, language: string): WeatherLabels {
  const whole = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const tenths = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const dayKey = (instant: string, timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(instant));
  return {
    heading: t('weather.heading'),
    day: (date) => day.format(new Date(`${date}T12:00:00Z`)),
    today: t('weather.today'),
    tomorrow: t('weather.tomorrow'),
    tempRange: (min, max) =>
      t('weather.tempRange', { min: whole.format(min), max: whole.format(max) }),
    rain: (mm) => t('weather.rain', { mm: tenths.format(mm) }),
    wind: (ms) => t('weather.wind', { speed: whole.format(ms) }),
    sea: (temp, station) => t('weather.sea', { temp: whole.format(temp), station }),
    uv: (value, station) =>
      t('weather.uv', {
        value: whole.format(value),
        band: t(`weather.uv_${uvBand(value)}`),
        station,
      }),
    warningLevel: (level) => t(`weather.level_${level}`),
    // "Thu 16:00 – 23:59" (in hr), or both days when the warning runs past midnight; at the property.
    warningTime: (onset, expires, timeZone) => {
      const dayTime = new Intl.DateTimeFormat(language, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      });
      const time = new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone });
      const sameDay = dayKey(onset, timeZone) === dayKey(expires, timeZone);
      return t('weather.warningTime', {
        from: dayTime.format(new Date(onset)),
        to: (sameDay ? time : dayTime).format(new Date(expires)),
      });
    },
    warningsUnknown: t('weather.warningsUnknown'),
    noWarnings: t('weather.noWarnings'),
    forecastUnavailable: t('weather.forecastUnavailable'),
    sources: t('weather.sources'),
    credit: (source) => t(source === 'DHMZ' ? 'weather.credit_dhmz' : 'weather.credit_met'),
    skyName: (sky) => t(`weather.sky_${sky}`),
  };
}

/** The host message card's strings. */
export const hostDraftLabels = (t: TFunction): HostDraftLabels => ({
  heading: t('hostMessage.heading'),
  explain: t('hostMessage.explain'),
  label: t('hostMessage.label'),
  counter: (count, max) => t('hostMessage.counter', { count, max }),
  empty: t('hostMessage.empty'),
  urgent: t('hostMessage.urgent'),
  send: t('hostMessage.send'),
  cancel: t('hostMessage.cancel'),
  sending: t('hostMessage.sending'),
});

/** A sent Host message's strings; the time in the interface language. */
export function hostSentLabels(t: TFunction, language: string): HostSentLabels {
  const time = new Intl.DateTimeFormat(language, { timeStyle: 'short' });
  return {
    heading: t('hostMessage.heading'),
    sentAt: (sentAt) => t('hostMessage.sentAt', { time: time.format(new Date(sentAt)) }),
    read: t('hostMessage.read'),
    urgent: t('hostMessage.urgent'),
  };
}

type Notice = Extract<InboxItem, { kind: 'notice' }>;

/** The notice kinds the Chat shows; a host reply shows as the reply itself. */
const NOTICE_KEYS = {
  order_confirmed: 'notice.order_confirmed',
  order_new_proposal: 'notice.order_new_proposal',
  order_cancelled: 'notice.order_cancelled',
  order_declined: 'notice.order_declined',
  order_expired: 'notice.order_expired',
  order_failed: 'notice.order_failed',
  order_reminder: 'notice.order_reminder',
  arrival_details: 'notice.arrival_details',
  checkout_reminder: 'notice.checkout_reminder',
  weather_warning: 'notice.weather_warning',
  ferry_disruption: 'notice.ferry_disruption',
} as const satisfies Partial<Record<Notice['notification'], string>>;

const isShownNotice = (kind: Notice['notification']): kind is keyof typeof NOTICE_KEYS =>
  kind in NOTICE_KEYS;

/**
 * A safety notice's parts: Fetivi's frame is in the interface language; the quote is the source's
 * own words, never translated, never Fetivi saying a sailing is cancelled.
 */
export interface SafetyWords {
  /** Weather warnings only, for the level chip. */
  level: WarningLevel | null;
  levelLabel: string | null;
  quote: string;
  source: string;
  sourceUrl: string;
  /** Further sentences: what it may affect, the sailing advisory, that a booking stands. */
  more: string[];
  links: { href: string; label: string }[];
}

export interface NoticeWords {
  text: string;
  checkoutBy: string | null;
  safety: SafetyWords | null;
}

function safetyWords(t: TFunction, language: string, notice: Notice): NoticeWords | null {
  const facts = notice.safety;
  if (!facts) return null;
  const f = orderFormat(t, language);
  const when = (item: { date: string; startTime: string | null }) =>
    f.dateTime(item.date, item.startTime ? `${item.date}T${item.startTime}` : null);
  if (facts.source === 'DHMZ') {
    const time = weatherLabels(t, language).warningTime(facts.onset, facts.expires, facts.timezone);
    const advisory = facts.advisory;
    const operator = advisory ? lineOperator(advisory.lines[0]) : null;
    return {
      text: t('notice.weather_warning', { area: facts.area, time }),
      checkoutBy: null,
      safety: {
        level: facts.level,
        levelLabel: t(`weather.level_${facts.level}`),
        quote: [facts.event, facts.description].filter(Boolean).join('. '),
        source: 'DHMZ',
        sourceUrl: DHMZ_URL,
        more: advisory
          ? [
              t('notice.sailingAdvisory', {
                lines: advisory.lines.map(ferryLineLabel).join(', '),
                offer: advisory.title,
                date: when(advisory),
                operator: operator?.name ?? '',
              }),
            ]
          : [],
        links:
          operator?.url != null
            ? [
                {
                  href: operator.url,
                  label: t('notice.checkOperator', { operator: operator.name }),
                },
              ]
            : [],
      },
    };
  }
  const { affected } = facts;
  return {
    text: t('notice.ferry_disruption'),
    checkoutBy: null,
    safety: {
      level: null,
      levelLabel: null,
      quote: facts.title,
      source: 'Jadrolinija',
      sourceUrl: facts.url,
      more: [
        t('notice.ferryAffects', {
          offer: affected.title,
          date: when(affected),
          lines: affected.lines.map(ferryLineLabel).join(', '),
        }),
        ...(affected.orderId ? [t('notice.orderStands')] : []),
      ],
      links: [{ href: facts.url, label: t('notice.readBulletin') }],
    },
  };
}

/**
 * A daily tip in the rule's words. An event shows its time only when it starts tomorrow; a
 * festival already running shows tomorrow's date.
 */
function tipWords(t: TFunction, language: string, notice: Notice): NoticeWords | null {
  const tip = notice.tip;
  if (!tip) return null;
  const f = orderFormat(t, language);
  const startsTomorrow = tip.startsAt?.slice(0, 10) === tip.date ? tip.startsAt : null;
  const km = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return {
    safety: null,
    checkoutBy: null,
    text: t(`notice.tip_${tip.rule}`, {
      offer: tip.title,
      date: f.dateTime(tip.date, startsTomorrow),
      distance:
        tip.distanceKm === null ? '' : t('notice.tipDistance', { km: km.format(tip.distanceKm) }),
      venue: tip.venueName ? t('notice.tipVenue', { venueName: tip.venueName }) : '',
    }),
  };
}

/** A notice's sentences in the interface language, dates as the receipts show them; null if never shown. */
export function noticeText(t: TFunction, language: string, notice: Notice): NoticeWords | null {
  if (notice.notification === 'daily_tip') return tipWords(t, language, notice);
  if (!isShownNotice(notice.notification)) return null;
  if (notice.notification === 'weather_warning' || notice.notification === 'ferry_disruption') {
    return safetyWords(t, language, notice);
  }
  const f = orderFormat(t, language);
  const { date, startTime, checkoutTime } = notice;
  return {
    safety: null,
    text: t(NOTICE_KEYS[notice.notification], {
      offer: notice.offerTitle ?? '',
      date: date ? f.dateTime(date, startTime ? `${date}T${startTime}` : null) : '',
    }),
    checkoutBy: checkoutTime
      ? t('notice.checkoutBy', { checkoutTime: f.time(`2000-01-01T${checkoutTime}`) })
      : null,
  };
}

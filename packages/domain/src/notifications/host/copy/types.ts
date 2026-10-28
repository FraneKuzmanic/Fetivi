import type { HandoffReason } from '../../../handoff/vocabulary';
import type { PriceUnit } from '../../../offers/vocabulary';

/** An account email: the subject and the whole sentence before the link. */
export interface AccountMailCopy {
  subject: string;
  text: string;
}

/**
 * Every string of the emails and pushes to hosts in one back-office language (ticket 53). Whole
 * sentences only; counts are functions so each language picks its own plural form. A missing key
 * is a type error, and the parity test checks the shapes match.
 */
export interface HostCopy {
  /** Luxon format for an answer-by time, day-first. */
  dateTimeFormat: string;
  /** `Intl` locale for prices. */
  numberLocale: string;
  account: {
    verify: AccountMailCopy;
    reset: AccountMailCopy;
    alreadyRegistered: AccountMailCopy;
  };
  message: {
    titleUrgent: string;
    titleNormal: string;
    subject: (title: string, unit: string) => string;
    intro: (property: string, unit: string, dates: string) => string;
    reason: (label: string) => string;
    urgentLine: string;
    readAndReply: (url: string) => string;
    noReply: string;
  };
  digest: {
    /** The digest subject and push title. */
    count: (n: number) => string;
    /** The line above the list. */
    waiting: (n: number) => string;
  };
  order: {
    subjectRequest: (offer: string) => string;
    subjectOrder: (offer: string) => string;
    asked: (offer: string) => string;
    askedAnswerBy: (offer: string, at: string) => string;
    ordered: (offer: string) => string;
    date: string;
    time: string;
    price: string;
    guest: string;
    guestPhone: string;
    /** The quantity's label per price unit; the value is the bare number. */
    quantity: Record<PriceUnit, string>;
    respond: (url: string) => string;
    acknowledge: (url: string) => string;
    see: (url: string) => string;
    noCommission: string;
  };
  stayDates: {
    subject: (unit: string, range: string) => string;
    moved: (property: string, unit: string) => string;
    newDates: string;
    pinSame: string;
    open: (url: string) => string;
  };
  reasons: Record<HandoffReason, string>;
}

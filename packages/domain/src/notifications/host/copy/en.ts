import type { HostCopy } from './types';

export const en: HostCopy = {
  dateTimeFormat: 'd MMM yyyy HH:mm',
  numberLocale: 'en-GB',
  account: {
    verify: {
      subject: 'Confirm your Fetivi email address',
      text: 'Open this link to confirm your email address. It works for 24 hours.',
    },
    reset: {
      subject: 'Reset your Fetivi password',
      text: 'Open this link to choose a new password. The link works for 1 hour.',
    },
    alreadyRegistered: {
      subject: 'You already have a Fetivi account',
      text: 'Someone tried to sign up with this email address, but you already have a Fetivi account. If you forgot your password, reset it here. The link works for 1 hour.',
    },
  },
  message: {
    titleUrgent: 'Urgent guest message',
    titleNormal: 'New guest message',
    subject: (title, unit) => `${title}: ${unit}`,
    intro: (property, unit, dates) =>
      `A guest staying at ${property}, ${unit} (${dates}) sent you a message.`,
    reason: (label) => `Reason: ${label}`,
    urgentLine: 'Fetivi marked it urgent.',
    readAndReply: (url) => `Read and reply in your inbox: ${url}`,
    noReply: 'Replies to this email do not reach the guest.',
  },
  digest: {
    count: (n) => (n === 1 ? '1 new guest message' : `${n} new guest messages`),
    waiting: (n) =>
      n === 1 ? 'A guest message is waiting for you:' : `${n} guest messages are waiting for you:`,
  },
  order: {
    subjectRequest: (offer) => `New request: ${offer}`,
    subjectOrder: (offer) => `New order: ${offer}`,
    asked: (offer) => `A guest asked for ${offer}.`,
    askedAnswerBy: (offer, at) =>
      `A guest asked for ${offer}. Please answer by ${at} in your Fetivi inbox.`,
    ordered: (offer) => `A guest ordered ${offer}.`,
    date: 'Date',
    time: 'Time',
    price: 'Price',
    guest: 'Guest',
    guestPhone: 'Guest phone',
    note: 'Guest note',
    original: 'Original',
    // A per-group price is flat and its quantity is the party size, so both count people.
    quantity: {
      person: 'People',
      group: 'People',
      item: 'Quantity',
      litre: 'Litres',
      kilogram: 'Kilograms',
      hour: 'Hours',
      day: 'Days',
    },
    respond: (url) => `Accept, decline or suggest another time: ${url}`,
    acknowledge: (url) => `Open your inbox to confirm you got it: ${url}`,
    see: (url) => `See it in your inbox: ${url}`,
    noCommission: 'Fetivi takes no commission on your own services.',
  },
  stayDates: {
    subject: (unit, range) => `Stay dates changed: ${unit}, ${range}`,
    moved: (property, unit) => `The calendar moved a Stay at ${property}, ${unit}.`,
    newDates: 'New dates',
    pinSame: 'The PIN stays the same. If the guest already has it, there is nothing to resend.',
    open: (url) => `Open the Stay: ${url}`,
  },
  reasons: {
    property_question: 'Question about the unit',
    problem: 'Problem',
    request: 'Request',
    guest_asked: 'Asked to contact you',
  },
};

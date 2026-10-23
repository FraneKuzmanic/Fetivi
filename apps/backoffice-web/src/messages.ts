import { ApiError } from './api';

const MESSAGES: Record<string, string> = {
  'invalid-input': 'Please check what you entered.',
  'invalid-credentials': 'The email or password is not right.',
  'email-not-verified': 'Please confirm your email address first. Check your inbox for the link.',
  'account-suspended': 'This account is suspended. Please contact Fetivi.',
  'too-many-attempts': 'Too many attempts. Please wait 15 minutes and try again.',
  'invalid-token': 'This link is invalid or has expired.',
  unauthenticated: 'Please log in again.',
  forbidden: 'You do not have access to this.',
  'stop-acting-first': 'Stop acting as a host first.',
  'bad-origin': 'This request was blocked. Please reload the page.',
  'not-found': 'Not found.',
  'already-replied': 'You already replied to this message.',
  'not-approved': 'Fetivi must approve the property before the unit can go live.',
  'not-ready':
    'This unit does not meet the go-live minimum yet. Open the setup wizard to see what is missing.',
  'stale-revision': 'The text changed while you were editing. Reload and try again.',
  'translation-not-failed': 'This translation is not in a failed state.',
  'destination-not-empty': "Delete this destination's records first.",
  'provider-has-offers': "Delete this Provider's Offers first.",
  'offer-has-slots': 'Delete the allotment slots first.',
  'seats-taken': 'Some seats are already taken.',
  'unit-not-live':
    'Stays can be registered once the unit is live: approved by Fetivi and the setup minimum done.',
  'stay-ended': 'This Stay has ended and can no longer be changed.',
  'unsupported-media': 'Use a JPEG, PNG or WebP photo, or an MP4 or WebM video.',
  'media-too-large': 'This file is too large: photos up to 10 MB, videos up to 50 MB.',
  'too-many-media': 'A block can have up to 6 photos or videos. Remove one first.',
  'unsupported-manual': 'Upload a PDF, Word (.docx) or text file, or paste the text.',
  'manual-too-large': 'This file is too large: manuals up to 10 MB.',
  'manual-too-long':
    'This manual is too long: up to 60,000 characters. Paste the parts guests need.',
  'manual-empty':
    'We could not find any text in this file. If it is a scanned PDF, paste the text instead.',
  'import-failed': 'Reading the manual failed. Please try again in a minute.',
  'import-not-configured': 'Importing manuals is not available right now. Please contact Fetivi.',
  'draft-resolved': 'This draft was already handled. Reload the page.',
  'invalid-calendar-url':
    'This is not an Airbnb or Booking.com calendar link. Paste the export link from their calendar settings.',
  'calendar-exists': 'This calendar is already added.',
  'too-many-calendars': 'A unit can have up to 6 calendars.',
  'proposal-gone': 'This booking was already handled. Reload the page.',
  'not-possibly-cancelled': 'This Stay is not marked as possibly cancelled.',
  'no-account': 'Create an onboarding link first: this Provider has no Stripe account yet.',
  'payments-not-configured': 'Online payments are not set up on this server (no Stripe key).',
  'stripe-unavailable': 'Stripe did not answer. Please try again in a minute.',
  'stripe-rejected': 'Stripe refused the request. Check the Provider details and try again.',
  'not-cancellable': 'This Order can no longer be cancelled. Reload the page to see its status.',
  'not-refundable':
    'This Order cannot be refunded here: it already has a refund, or nothing is captured. Further refunds are made in the Provider’s Stripe dashboard.',
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}

export function messageOf(error: unknown): string {
  return messageFor(error instanceof ApiError ? error.code : 'internal');
}

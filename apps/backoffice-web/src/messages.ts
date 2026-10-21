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
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}

export function messageOf(error: unknown): string {
  return messageFor(error instanceof ApiError ? error.code : 'internal');
}

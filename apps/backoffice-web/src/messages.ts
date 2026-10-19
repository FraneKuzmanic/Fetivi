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
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}

export function messageOf(error: unknown): string {
  return messageFor(error instanceof ApiError ? error.code : 'internal');
}

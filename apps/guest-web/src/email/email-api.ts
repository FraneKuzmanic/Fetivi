import { api } from '../api';

/** The Space's email opt-in. `email` is null until the guest gave one. */
export interface EmailState {
  email: string | null;
  verified: boolean;
  tips: boolean;
}

/** The same check as the booking card's email field; the server has the final say. */
export const isEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

export const getEmail = () => api<EmailState>('/api/email');

export const optInEmail = (email: string, tips: boolean) =>
  api<EmailState>('/api/email', { method: 'POST', body: { email, tips } });

export const setTips = (tips: boolean) =>
  api<EmailState>('/api/email', { method: 'PATCH', body: { tips } });

export const resendVerification = () => api<void>('/api/email/verification', { method: 'POST' });

export const verifyEmail = (token: string) =>
  api<void>('/api/email/verify', { method: 'POST', body: { token } });

/** The daily-tip email's unsubscribe link: works without the Space. */
export const unsubscribeTips = (space: string, token: string) =>
  api<void>('/api/email/tips/unsubscribe', { method: 'POST', body: { space, token } });

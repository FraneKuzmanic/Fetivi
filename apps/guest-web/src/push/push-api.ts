import { api } from '../api';

/** Whether this space can still be offered push. `publicKey` is null when push is not configured. */
export interface PushState {
  publicKey: string | null;
  offered: boolean;
  subscribed: boolean;
}

export const getPush = () => api<PushState>('/api/push');

/** The offer was declined or dismissed: it is never shown again. */
export const recordOffer = () => api<void>('/api/push/offer', { method: 'POST' });

/** The browser's subscription (`PushSubscription.toJSON()`); also spends the offer. */
export const saveSubscription = (subscription: PushSubscriptionJSON) =>
  api<void>('/api/push/subscription', { method: 'POST', body: subscription });

import { api, type Space } from '../api';

/** Always the same answer for a working link, whether or not the email matches a Space. */
export const requestRecoveryAt = (slug: string, email: string) =>
  api<void>(`/api/access/${encodeURIComponent(slug)}/recovery`, {
    method: 'POST',
    body: { email },
  });

/** From Settings: a link that opens this Space on another device. */
export const requestRecovery = () => api<void>('/api/recovery', { method: 'POST' });

/** Spends the link's token; the server moves the Space to this device. */
export const restore = (token: string) =>
  api<Space>('/api/recovery/restore', { method: 'POST', body: { token } });

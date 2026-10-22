import { api } from '../api';

export type HandoffStatus = 'sent' | 'read';

/** The Chat badge and each Host message's state. "Read" only once the host opened it. */
export interface InboxState {
  unread: number;
  handoffs: { id: string; status: HandoffStatus }[];
}

export const getInbox = () => api<InboxState>('/api/inbox');

/** The guest has seen the Chat: the badge counts from now. */
export const markInboxSeen = () => api<void>('/api/inbox/seen', { method: 'POST' });

import type { HostMessage } from '../../api';
import { i18next, localeOf } from '../../i18n';

const t = i18next.getFixedT(null, 'host', 'inbox');

/** The words the host reads: the translation once it is there, else the guest's own. */
export const shownText = (m: HostMessage) => m.translation ?? m.text;

export type MessageState = 'new' | 'read' | 'replied';

export function messageState(m: HostMessage): MessageState {
  if (m.reply) return 'replied';
  return m.readAt ? 'read' : 'new';
}

const STATE_TONES: Record<MessageState, string> = { new: 'wait', read: 'neutral', replied: 'ok' };

/** A message's state as a chip, in the interface language. */
export const stateChip = (state: MessageState): { label: string; tone: string } => ({
  label: t(state),
  tone: STATE_TONES[state],
});

/** "22 Oct, 14:05" (or "22. lis 14:05") in the browser's zone. */
export const receivedAt = (iso: string) =>
  new Date(iso).toLocaleString(localeOf(i18next.language), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A one-line preview of the message. */
export function preview(m: HostMessage, max = 90): string {
  const text = shownText(m).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Where the reply is: with the guest, being translated, or waiting for the guest's chat. */
export function replyDelivery(reply: NonNullable<HostMessage['reply']>): string {
  if (reply.deliveredAt) return t('delivered');
  if (reply.translationState === 'pending') return t('translating');
  return t('waitingDelivery');
}

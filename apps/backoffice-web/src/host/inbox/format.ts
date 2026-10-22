import type { HandoffReason } from '@fetivi/domain/handoff-vocabulary';
import type { HostMessage } from '../../api';

export const REASON_LABELS: Record<HandoffReason, string> = {
  property_question: 'Question about the unit',
  problem: 'Problem',
  request: 'Request',
  guest_asked: 'Asked to contact you',
};

/** The words the host reads: the translation once it is there, else the guest's own. */
export const shownText = (m: HostMessage) => m.translation ?? m.text;

export type MessageState = 'new' | 'read' | 'replied';

export function messageState(m: HostMessage): MessageState {
  if (m.reply) return 'replied';
  return m.readAt ? 'read' : 'new';
}

export const STATE_CHIPS: Record<MessageState, { label: string; tone: string }> = {
  new: { label: 'New', tone: 'wait' },
  read: { label: 'Read', tone: 'neutral' },
  replied: { label: 'Replied', tone: 'ok' },
};

const time = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "22 Oct, 14:05" in the browser's zone. */
export const receivedAt = (iso: string) => time.format(new Date(iso));

/** A one-line preview of the message. */
export function preview(m: HostMessage, max = 90): string {
  const text = shownText(m).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Where the reply is: with the guest, being translated, or waiting for the guest's chat. */
export function replyDelivery(reply: NonNullable<HostMessage['reply']>): string {
  if (reply.deliveredAt) return 'Delivered to the guest';
  if (reply.translationState === 'pending') return 'Translating for the guest…';
  return 'Waiting to be delivered';
}

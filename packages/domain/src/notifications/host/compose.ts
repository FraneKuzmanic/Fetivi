import type { HandoffReason, HandoffUrgency } from '../../handoff/vocabulary';
import type { CivilDate } from '../../time';
import type { PushMessage } from '../guest/push';
import { formatCivilDate } from '../provider/compose';
import { HOST_INBOX_PATH } from './vocabulary';

// Host emails and pushes about Host messages: plain English, like the rest of the back office.
// They carry no guest text, no booker name and no PIN, and point to the Inbox, where the host
// replies (no reply-by-email, PRD §6.6).

export const REASON_LABELS: Record<HandoffReason, string> = {
  property_question: 'Question about the property',
  problem: 'Problem',
  request: 'Request',
  guest_asked: 'Wants to talk to you',
};

/** What a host notification may say about a Host message. Deliberately no `text` field. */
export interface HostMessageFacts {
  id: string;
  unitName: string;
  propertyName: string;
  checkIn: CivilDate;
  checkout: CivilDate;
  reason: HandoffReason;
  urgency: HandoffUrgency;
}

const NO_REPLY_LINE = 'Replies to this email do not reach the guest.';

function dates(f: HostMessageFacts): string {
  return `${formatCivilDate(f.checkIn, 'en')} – ${formatCivilDate(f.checkout, 'en')}`;
}

/** One digest line; the property is named when the host's messages span several. */
export function messageLine(f: HostMessageFacts, several: boolean): string {
  const place = several ? `${f.propertyName} · ${f.unitName}` : f.unitName;
  return `${place}, ${dates(f)}: ${REASON_LABELS[f.reason]}`;
}

function messagePath(id: string): string {
  return `${HOST_INBOX_PATH}?message=${id}`;
}

function title(f: HostMessageFacts): string {
  return f.urgency === 'urgent' ? 'Urgent guest message' : 'New guest message';
}

function countLabel(n: number): string {
  return n === 1 ? '1 new guest message' : `${n} new guest messages`;
}

export function composeHostMessageEmail(
  f: HostMessageFacts,
  webOrigin: string,
): { subject: string; text: string } {
  return {
    subject: `${title(f)}: ${f.unitName}`,
    text: [
      `A guest staying at ${f.propertyName}, ${f.unitName} (${dates(f)}) sent you a message.`,
      '',
      `Reason: ${REASON_LABELS[f.reason]}`,
      ...(f.urgency === 'urgent' ? ['Fetivi marked it urgent.'] : []),
      '',
      `Read and reply in your inbox: ${webOrigin}${messagePath(f.id)}`,
      '',
      NO_REPLY_LINE,
    ].join('\n'),
  };
}

/** One email for a digest slot; `list` is in `sent_at` order, oldest first. */
export function composeHostDigestEmail(
  list: readonly HostMessageFacts[],
  webOrigin: string,
): { subject: string; text: string } {
  const several = new Set(list.map((f) => f.propertyName)).size > 1;
  return {
    subject: countLabel(list.length),
    text: [
      list.length === 1
        ? 'A guest message is waiting for you:'
        : `${list.length} guest messages are waiting for you:`,
      '',
      ...list.map((f) => `- ${messageLine(f, several)}`),
      '',
      `Read and reply in your inbox: ${webOrigin}${HOST_INBOX_PATH}`,
      '',
      NO_REPLY_LINE,
    ].join('\n'),
  };
}

export function composeHostMessagePush(f: HostMessageFacts): PushMessage {
  return {
    title: title(f),
    body: `${f.unitName} · ${REASON_LABELS[f.reason]}`,
    url: messagePath(f.id),
  };
}

export function composeHostDigestPush(list: readonly HostMessageFacts[]): PushMessage {
  const units = [...new Set(list.map((f) => f.unitName))];
  return { title: countLabel(list.length), body: units.join(', '), url: HOST_INBOX_PATH };
}

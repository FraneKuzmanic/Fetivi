import type { HandoffReason, HandoffUrgency } from '../../handoff/vocabulary';
import type { BackofficeLanguage } from '../../property/vocabulary';
import type { CivilDate } from '../../time';
import type { PushMessage } from '../guest/push';
import { formatCivilDate } from '../provider/compose';
import { HOST_COPY } from './copy';
import { HOST_INBOX_PATH } from './vocabulary';

// Host emails and pushes about Host messages, in the host's back-office language (ticket 53).
// They carry no guest text, no booker name and no PIN, and point to the Inbox, where the host
// replies (no reply-by-email, PRD §6.6).

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

function dates(f: HostMessageFacts, language: BackofficeLanguage): string {
  return `${formatCivilDate(f.checkIn, language)} – ${formatCivilDate(f.checkout, language)}`;
}

/** One digest line; the property is named when the host's messages span several. */
export function messageLine(
  f: HostMessageFacts,
  several: boolean,
  language: BackofficeLanguage,
): string {
  const place = several ? `${f.propertyName} · ${f.unitName}` : f.unitName;
  return `${place}, ${dates(f, language)}: ${HOST_COPY[language].reasons[f.reason]}`;
}

function messagePath(id: string): string {
  return `${HOST_INBOX_PATH}?message=${id}`;
}

function title(f: HostMessageFacts, language: BackofficeLanguage): string {
  const copy = HOST_COPY[language].message;
  return f.urgency === 'urgent' ? copy.titleUrgent : copy.titleNormal;
}

export function composeHostMessageEmail(
  f: HostMessageFacts,
  webOrigin: string,
  language: BackofficeLanguage,
): { subject: string; text: string } {
  const copy = HOST_COPY[language];
  return {
    subject: copy.message.subject(title(f, language), f.unitName),
    text: [
      copy.message.intro(f.propertyName, f.unitName, dates(f, language)),
      '',
      copy.message.reason(copy.reasons[f.reason]),
      ...(f.urgency === 'urgent' ? [copy.message.urgentLine] : []),
      '',
      copy.message.readAndReply(`${webOrigin}${messagePath(f.id)}`),
      '',
      copy.message.noReply,
    ].join('\n'),
  };
}

/** One email for a digest slot; `list` is in `sent_at` order, oldest first. */
export function composeHostDigestEmail(
  list: readonly HostMessageFacts[],
  webOrigin: string,
  language: BackofficeLanguage,
): { subject: string; text: string } {
  const copy = HOST_COPY[language];
  const several = new Set(list.map((f) => f.propertyName)).size > 1;
  return {
    subject: copy.digest.count(list.length),
    text: [
      copy.digest.waiting(list.length),
      '',
      ...list.map((f) => `- ${messageLine(f, several, language)}`),
      '',
      copy.message.readAndReply(`${webOrigin}${HOST_INBOX_PATH}`),
      '',
      copy.message.noReply,
    ].join('\n'),
  };
}

export function composeHostMessagePush(
  f: HostMessageFacts,
  language: BackofficeLanguage,
): PushMessage {
  return {
    title: title(f, language),
    body: `${f.unitName} · ${HOST_COPY[language].reasons[f.reason]}`,
    url: messagePath(f.id),
  };
}

export function composeHostDigestPush(
  list: readonly HostMessageFacts[],
  language: BackofficeLanguage,
): PushMessage {
  const units = [...new Set(list.map((f) => f.unitName))];
  return {
    title: HOST_COPY[language].digest.count(list.length),
    body: units.join(', '),
    url: HOST_INBOX_PATH,
  };
}

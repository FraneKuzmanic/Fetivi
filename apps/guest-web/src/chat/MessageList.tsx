import { CitedText, citesAny, uncitedText } from '@fetivi/ui';
import { componentPart, type WebResultsPayload } from '@fetivi/ui/payloads';
import { type ChatStatus, isToolUIPart, type UIMessage } from 'ai';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { McpAppPart } from '../mcp-apps/McpAppPart';
import { Mascot } from '../shell/Mascot';
import {
  type InboxEntry,
  isComponentPart,
  isElicitationPart,
  isGuestAnswer,
  isMcpAppPart,
  messageText,
} from './chat-api';
import { AnswerFeedback } from './feedback/AnswerFeedback';
import type { AnswerRating } from './feedback/feedback-api';
import { CancelOrderPart, isCancelOrderCard } from './render/CancelOrderPart';
import { ComponentPart } from './render/ComponentPart';
import { type CardAnswer, ConfirmationPart } from './render/ConfirmationPart';
import { HostMessagePart, isHostMessageCard } from './render/HostMessagePart';
import { InboxPart } from './render/InboxPart';
import { citationLabels } from './render/labels';
import { isRespondOrderCard, RespondOrderPart } from './render/RespondOrderPart';

const NEAR_BOTTOM_PX = 120;

const isBusy = (status: ChatStatus) => status === 'submitted' || status === 'streaming';

type WebResult = WebResultsPayload['results'][number];
type Card = { key: string; card: unknown; state: 'open' | 'sending' };
type TextSegment = { key: string; text: string; results: WebResult[] | null };
type Segment = TextSegment | { key: string; data: unknown } | { key: string; app: unknown } | Card;

const nameOf = (segment: Segment) =>
  'data' in segment ? (segment.data as { name?: unknown } | null)?.name : undefined;
const isChips = (segment: Segment) => nameOf(segment) === 'follow-up-chips';
const isPicker = (segment: Segment) => nameOf(segment) === 'availability-picker';
const isDayPlan = (segment: Segment) => nameOf(segment) === 'day-plan';

/**
 * The confirmation card of one elicitation part, if it still waits: open while the call has no
 * result, sending while the guest's tap is on its way. A tap left on the part after a reply (the
 * server asked again) opens the card again. Answered cards are gone: the receipt or the words tell.
 */
function cardOf(message: UIMessage, part: UIMessage['parts'][number], busy: boolean): Card | null {
  if (!isElicitationPart(part) || !part.id) return null;
  const call = message.parts.find((p) => isToolUIPart(p) && p.toolCallId === part.id);
  if (!call || !isToolUIPart(call)) return null;
  const tapped = call.state === 'output-available' && isGuestAnswer(call.output);
  if (call.state !== 'input-available' && !tapped) return null;
  return { key: `card-${part.id}`, card: part.data, state: tapped && busy ? 'sending' : 'open' };
}

const cardsOf = (message: UIMessage, busy: boolean): Card[] =>
  message.parts.flatMap((part) => cardOf(message, part, busy) ?? []);

/** Whether an answer ends with a card for the guest to confirm, for the spoken announcement. */
export const asksToConfirm = (message: UIMessage | undefined) =>
  message !== undefined && cardsOf(message, false).length > 0;

/**
 * The announcement of an answer's open card: a cancellation, new terms, a host message or a
 * booking.
 */
function cardShownKey(
  message: UIMessage,
):
  | 'cancelOrder.cardShown'
  | 'respondOrder.cardShown'
  | 'hostMessage.cardShown'
  | 'order.cardShown'
  | null {
  const [card] = cardsOf(message, false);
  if (!card) return null;
  if (isCancelOrderCard(card.card)) return 'cancelOrder.cardShown';
  if (isRespondOrderCard(card.card)) return 'respondOrder.cardShown';
  return isHostMessageCard(card.card) ? 'hostMessage.cardShown' : 'order.cardShown';
}

/** A web search's results, if the component part's data holds them. */
function webResultsOf(data: unknown): WebResult[] | null {
  const parsed = componentPart.safeParse(data);
  return parsed.success && parsed.data.name === 'web-results' ? parsed.data.payload.results : null;
}

/**
 * An answer reads in the order it streamed, so new content only ever appears below what is
 * shown: consecutive text joins one bubble until a card, component or widget comes between
 * (calls with nothing to show, like a search, do not split it). Only the last day plan shows
 * (get_plan then update_plan: the later state counts), and follow-up chips always come last.
 *
 * Web results never show in place: text after a search cites them with `[n]` badges. An answer
 * that cited none shows one row of their sources at the end, once it has finished, so it never
 * appears and then vanishes when the first badge streams in.
 *
 * Only what shows is a segment: blank text and an open card outside the newest answer (it acts
 * only there) are left out, so a turn with nothing to show gets no row, not a lone mascot.
 */
function segmentsOf(
  message: UIMessage,
  { busy, finished, latest }: { busy: boolean; finished: boolean; latest: boolean },
): Segment[] {
  const segments: Segment[] = [];
  const chips: Segment[] = [];
  let run: TextSegment | null = null;
  let results: { key: string; data: unknown; list: WebResult[] } | null = null;
  const show = (segment: Segment) => {
    run = null;
    segments.push(segment);
  };
  const lastPlan = message.parts.findLastIndex(
    (p) => isComponentPart(p) && nameOf({ key: '', data: p.data }) === 'day-plan',
  );
  for (const [index, part] of message.parts.entries()) {
    if (part.type === 'text') {
      if (!part.text.trim()) continue;
      if (run)
        run.text = `${run.text}
${part.text}`;
      else {
        run = { key: `text-${index}`, text: part.text, results: results?.list ?? null };
        segments.push(run);
      }
      continue;
    }
    if (isElicitationPart(part)) {
      const card = cardOf(message, part, busy);
      if (card && (card.state !== 'open' || latest)) show(card);
    } else if (isComponentPart(part)) {
      const segment = { key: part.id ?? `part-${index}`, data: part.data };
      const found = webResultsOf(part.data);
      if (found) {
        // Text after the search cites these results, so it starts its own bubble.
        run = null;
        results = { ...segment, list: found };
      } else if (isChips(segment)) chips.push(segment);
      else if (!isDayPlan(segment) || index === lastPlan) show(segment);
    } else if (isMcpAppPart(part)) {
      show({ key: `app-${part.id ?? index}`, app: part.data });
    }
  }
  const cited = segments.some(
    (s) => 'text' in s && s.results !== null && citesAny(s.text, s.results.length),
  );
  const sources: Segment[] =
    results && !cited && finished ? [{ key: results.key, data: results.data }] : [];
  return [...segments, ...sources, ...chips];
}

/** An answer's words as read out: citation markers resolve to badges, so they are not spoken. */
function spokenText(message: UIMessage): string {
  const results = message.parts.flatMap((p) => (isComponentPart(p) && webResultsOf(p.data)) || []);
  const text = messageText(message);
  return results.length > 0 ? uncitedText(text, results.length) : text;
}

/** Whether a part is text still arriving: the guest sees it grow, so no typing line. */
const isStreamingText = (part: UIMessage['parts'][number] | undefined) =>
  part?.type === 'text' && part.state === 'streaming' && part.text.length > 0;

/** How many place cards an answer shows, for the spoken announcement. */
const placesShown = (message: UIMessage) =>
  message.parts.filter(isComponentPart).reduce((n, p) => {
    const parsed = componentPart.safeParse(p.data);
    return parsed.success && parsed.data.name === 'place-carousel'
      ? n + parsed.data.payload.places.length
      : n;
  }, 0);

/**
 * The conversation. The log itself is not live, so partial tokens are never read out; a separate
 * polite status line receives each answer once it is complete.
 */
export function MessageList({
  messages,
  inbox = [],
  feedback = {},
  status,
  interactive,
  onSend,
  onSomethingElse,
  onAnswer,
}: {
  messages: UIMessage[];
  /** Inbox messages (host replies), each shown after the chat message it followed. */
  inbox?: InboxEntry[];
  /** The guest's ratings of answers, by message id. */
  feedback?: Record<string, AnswerRating>;
  status: ChatStatus;
  /** False while a turn runs or after the Stay: the newest answer's chips and choices then hide. */
  interactive: boolean;
  onSend: (text: string) => void;
  onSomethingElse: () => void;
  /** The guest's Confirm or Cancel on a confirmation card. */
  onAnswer: (answer: CardAnswer) => void;
}) {
  const { t } = useTranslation();
  const stick = useRef(true);
  const previous = useRef(status);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const onScroll = () => {
      const { scrollY, innerHeight } = window;
      stick.current = scrollY + innerHeight >= document.body.scrollHeight - NEAR_BOTTOM_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Follows new content only when the guest is already at the bottom; an empty chat stays at the
  // welcome.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new content is the trigger.
  useEffect(() => {
    // To the page's end, not the last message's: the composer and tab bar cover the bottom.
    if (stick.current && messages.length > 0) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages, status]);

  useEffect(() => {
    const wasBusy = isBusy(previous.current);
    previous.current = status;
    if (!wasBusy || status !== 'ready') return;
    const last = messages.at(-1);
    if (last?.role !== 'assistant') return;
    const count = placesShown(last);
    const cardKey = cardShownKey(last);
    setAnnouncement(
      [
        spokenText(last),
        count > 0 ? t('components.placesShown', { count }) : '',
        cardKey ? t(cardKey) : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }, [status, messages, t]);

  const last = messages.at(-1);
  const inboxAfter = (id: string | null) => inbox.filter((e) => e.afterId === id);
  const inboxRows = (id: string | null) =>
    inboxAfter(id).map((e) => <InboxPart key={`inbox-${e.id}`} item={e.item} />);
  // Shown while Fetivi works and nothing is arriving, also between steps of one answer.
  const typing =
    isBusy(status) && !(last?.role === 'assistant' && isStreamingText(last.parts.at(-1)));

  return (
    <>
      <div className="messages" role="log" aria-live="off" aria-busy={isBusy(status)}>
        {inboxRows(null)}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {renderMessage(m, i)}
            {inboxRows(m.id)}
          </Fragment>
        ))}
        {typing && <p className="typing">{t('chat.typing')}</p>}
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );

  function renderMessage(m: UIMessage, i: number) {
    if (m.role === 'user') {
      const text = messageText(m);
      if (!text) return null;
      return (
        <p className="bubble guest">
          <span className="visually-hidden">{`${t('chat.you')}: `}</span>
          {text}
        </p>
      );
    }
    const streaming = isBusy(status) && i === messages.length - 1;
    // An open card acts only on the newest answer while the guest can reply.
    const latest = interactive && i === messages.length - 1;
    const segments = segmentsOf(m, { busy: isBusy(status), finished: !streaming, latest });
    if (segments.length === 0) return null;
    const previous = messages[i - 1];
    // A host reply in between starts a new run, so Fetivi's mascot shows again.
    const firstOfRun = previous?.role !== 'assistant' || inboxAfter(previous.id).length > 0;
    // Once an answer holds a confirmation card, its starts are history: a pick there would
    // cancel the card, and after the tap its places left are out of date.
    const pickerLive = latest && !m.parts.some(isElicitationPart);
    let named = false;
    // Rated by the stored id: the newest answer's id is final only once it has finished.
    const rateable = messageText(m).trim().length > 0 && !streaming;
    // Under the row, so the mascot stays beside the answer itself.
    return (
      <>
        <div className="fetivi-row">
          <span className="avatar">{firstOfRun && <Mascot className="avatar-mascot" />}</span>
          <div className="fetivi-turn">
            {segments.map((segment) => {
              if ('card' in segment) {
                if (isCancelOrderCard(segment.card)) {
                  return (
                    <CancelOrderPart
                      key={segment.key}
                      data={segment.card}
                      state={segment.state}
                      onAnswer={onAnswer}
                    />
                  );
                }
                if (isRespondOrderCard(segment.card)) {
                  return (
                    <RespondOrderPart
                      key={segment.key}
                      data={segment.card}
                      state={segment.state}
                      onAnswer={onAnswer}
                    />
                  );
                }
                if (isHostMessageCard(segment.card)) {
                  return (
                    <HostMessagePart
                      key={segment.key}
                      data={segment.card}
                      state={segment.state}
                      onAnswer={onAnswer}
                    />
                  );
                }
                return (
                  <ConfirmationPart
                    key={segment.key}
                    data={segment.card}
                    state={segment.state}
                    onAnswer={onAnswer}
                  />
                );
              }
              if ('app' in segment) {
                // Brought into view only while the newest answer streams, so history never jumps.
                return (
                  <McpAppPart
                    key={segment.key}
                    data={segment.app}
                    reveal={i === messages.length - 1 && isBusy(status)}
                  />
                );
              }
              if (!('text' in segment)) {
                return (
                  <ComponentPart
                    key={segment.key}
                    data={segment.data}
                    latest={isPicker(segment) ? pickerLive : latest}
                    onSend={onSend}
                    onSomethingElse={onSomethingElse}
                  />
                );
              }
              const name = !named;
              named = true;
              return (
                <p key={segment.key} className="bubble fetivi">
                  {name && <span className="visually-hidden">{`${t('chat.fetivi')}: `}</span>}
                  {segment.results ? (
                    <CitedText
                      text={segment.text}
                      results={segment.results}
                      labels={citationLabels(t)}
                    />
                  ) : (
                    segment.text
                  )}
                </p>
              );
            })}
          </div>
        </div>
        {rateable && <AnswerFeedback messageId={m.id} initial={feedback[m.id]} />}
      </>
    );
  }
}

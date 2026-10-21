import { componentPart } from '@fetivi/ui/payloads';
import { type ChatStatus, isToolUIPart, type UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot } from '../shell/Mascot';
import { isComponentPart, isElicitationPart, isGuestAnswer, messageText } from './chat-api';
import { ComponentPart } from './render/ComponentPart';
import { type CardAnswer, ConfirmationPart } from './render/ConfirmationPart';

const NEAR_BOTTOM_PX = 120;

const isBusy = (status: ChatStatus) => status === 'submitted' || status === 'streaming';

type Card = { key: string; card: unknown; state: 'open' | 'sending' };
type Segment = { key: string; text: string } | { key: string; data: unknown } | Card;

const isChips = (segment: Segment) =>
  'data' in segment && (segment.data as { name?: unknown } | null)?.name === 'follow-up-chips';

/**
 * The confirmation cards still waiting: open while the call has no result, sending while the
 * guest's tap is on its way. A tap left on the part after a reply (the server asked again, or the
 * request failed) opens the card again. Answered cards are gone: the receipt or the words tell.
 */
function cardsOf(message: UIMessage, busy: boolean): Card[] {
  const cards: Card[] = [];
  for (const part of message.parts) {
    if (!isElicitationPart(part) || !part.id) continue;
    const call = message.parts.find((p) => isToolUIPart(p) && p.toolCallId === part.id);
    if (!call || !isToolUIPart(call)) continue;
    const tapped = call.state === 'output-available' && isGuestAnswer(call.output);
    if (call.state !== 'input-available' && !tapped) continue;
    cards.push({
      key: `card-${part.id}`,
      card: part.data,
      state: tapped && busy ? 'sending' : 'open',
    });
  }
  return cards;
}

/** Whether an answer ends with a card for the guest to confirm, for the spoken announcement. */
const asksToConfirm = (message: UIMessage) => cardsOf(message, false).length > 0;

/**
 * An answer reads as its words first, in one bubble, then any confirmation card, then its
 * components in part order, with follow-up chips last: the model often searches before it
 * writes, and the words introduce the cards.
 */
function segmentsOf(message: UIMessage, busy: boolean): Segment[] {
  const text = message.parts.flatMap((p) => (p.type === 'text' && p.text ? [p.text] : []));
  const components: Segment[] = [];
  message.parts.forEach((part, index) => {
    if (isComponentPart(part))
      components.push({ key: part.id ?? `part-${index}`, data: part.data });
  });
  return [
    ...(text.length > 0 ? [{ key: 'text', text: text.join('\n') }] : []),
    ...cardsOf(message, busy),
    ...components.filter((s) => !isChips(s)),
    ...components.filter(isChips),
  ];
}

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
  status,
  interactive,
  onSend,
  onSomethingElse,
  onAnswer,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  /** False while a turn runs or after the Stay: the newest answer's chips and choices then hide. */
  interactive: boolean;
  onSend: (text: string) => void;
  onSomethingElse: () => void;
  /** The guest's Confirm or Cancel on a booking card. */
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
    setAnnouncement(
      [
        messageText(last),
        count > 0 ? t('components.placesShown', { count }) : '',
        asksToConfirm(last) ? t('booking.cardShown') : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }, [status, messages, t]);

  const last = messages.at(-1);
  const typing =
    isBusy(status) && !(last?.role === 'assistant' && messageText(last).trim().length > 0);

  return (
    <>
      <div className="messages" role="log" aria-live="off" aria-busy={isBusy(status)}>
        {messages.map((m, i) => {
          if (m.role === 'user') {
            const text = messageText(m);
            if (!text) return null;
            return (
              <p key={m.id} className="bubble guest">
                <span className="visually-hidden">{`${t('chat.you')}: `}</span>
                {text}
              </p>
            );
          }
          const segments = segmentsOf(m, isBusy(status));
          if (segments.length === 0) return null;
          const firstOfRun = messages[i - 1]?.role !== 'assistant';
          const latest = interactive && i === messages.length - 1;
          let named = false;
          return (
            <div key={m.id} className="fetivi-row">
              <span className="avatar">{firstOfRun && <Mascot className="avatar-mascot" />}</span>
              <div className="fetivi-turn">
                {segments.map((segment) => {
                  if ('card' in segment) {
                    // An open card acts only on the newest answer while the guest can reply.
                    if (segment.state === 'open' && !latest) return null;
                    return (
                      <ConfirmationPart
                        key={segment.key}
                        data={segment.card}
                        state={segment.state}
                        onAnswer={onAnswer}
                      />
                    );
                  }
                  if (!('text' in segment)) {
                    return (
                      <ComponentPart
                        key={segment.key}
                        data={segment.data}
                        latest={latest}
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
                      {segment.text}
                    </p>
                  );
                })}
              </div>
            </div>
          );
        })}
        {typing && <p className="typing">{t('chat.typing')}</p>}
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}

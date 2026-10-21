import { componentPart } from '@fetivi/ui/payloads';
import type { ChatStatus, UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot } from '../shell/Mascot';
import { isComponentPart, messageText } from './chat-api';
import { ComponentPart } from './render/ComponentPart';

const NEAR_BOTTOM_PX = 120;

const isBusy = (status: ChatStatus) => status === 'submitted' || status === 'streaming';

type Segment = { key: string; text: string } | { key: string; data: unknown };

const isChips = (segment: Segment) =>
  'data' in segment && (segment.data as { name?: unknown } | null)?.name === 'follow-up-chips';

/**
 * An answer in part order: consecutive text joins into one bubble, each component stands alone.
 * Follow-up chips always come last, even when the model wrote more after showing them.
 */
function segmentsOf(message: UIMessage): Segment[] {
  const out: Segment[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === 'text') {
      if (!part.text) return;
      const last = out.at(-1);
      if (last && 'text' in last) last.text = `${last.text}\n${part.text}`;
      else out.push({ key: `text-${index}`, text: part.text });
    } else if (isComponentPart(part)) {
      out.push({ key: part.id ?? `part-${index}`, data: part.data });
    }
  });
  return [...out.filter((s) => !isChips(s)), ...out.filter(isChips)];
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
}: {
  messages: UIMessage[];
  status: ChatStatus;
  /** False while a turn runs or after the Stay: the newest answer's chips and choices then hide. */
  interactive: boolean;
  onSend: (text: string) => void;
  onSomethingElse: () => void;
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
    const text = messageText(last);
    setAnnouncement(
      count > 0 ? [text, t('components.placesShown', { count })].filter(Boolean).join(' ') : text,
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
          const segments = segmentsOf(m);
          if (segments.length === 0) return null;
          const firstOfRun = messages[i - 1]?.role !== 'assistant';
          const latest = interactive && i === messages.length - 1;
          let named = false;
          return (
            <div key={m.id} className="fetivi-row">
              <span className="avatar">{firstOfRun && <Mascot className="avatar-mascot" />}</span>
              <div className="fetivi-turn">
                {segments.map((segment) => {
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

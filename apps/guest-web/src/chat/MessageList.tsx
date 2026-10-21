import type { ChatStatus, UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot } from '../shell/Mascot';
import { messageText } from './chat-api';

const NEAR_BOTTOM_PX = 120;

const isBusy = (status: ChatStatus) => status === 'submitted' || status === 'streaming';

/**
 * The conversation. The log itself is not live, so partial tokens are never read out; a separate
 * polite status line receives each answer once it is complete.
 */
export function MessageList({ messages, status }: { messages: UIMessage[]; status: ChatStatus }) {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
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
    if (stick.current && messages.length > 0) end.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  useEffect(() => {
    const wasBusy = isBusy(previous.current);
    previous.current = status;
    if (!wasBusy || status !== 'ready') return;
    const last = messages.at(-1);
    if (last?.role === 'assistant') setAnnouncement(messageText(last));
  }, [status, messages]);

  const last = messages.at(-1);
  const typing =
    isBusy(status) && !(last?.role === 'assistant' && messageText(last).trim().length > 0);

  return (
    <>
      <div className="messages" role="log" aria-live="off" aria-busy={isBusy(status)}>
        {messages.map((m, i) => {
          const text = messageText(m);
          if (!text) return null;
          if (m.role === 'user') {
            return (
              <p key={m.id} className="bubble guest">
                <span className="visually-hidden">{`${t('chat.you')}: `}</span>
                {text}
              </p>
            );
          }
          const firstOfRun = messages[i - 1]?.role !== 'assistant';
          return (
            <div key={m.id} className="fetivi-row">
              <span className="avatar">{firstOfRun && <Mascot className="avatar-mascot" />}</span>
              <p className="bubble fetivi">
                <span className="visually-hidden">{`${t('chat.fetivi')}: `}</span>
                {text}
              </p>
            </div>
          );
        })}
        {typing && <p className="typing">{t('chat.typing')}</p>}
        <div ref={end} />
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}

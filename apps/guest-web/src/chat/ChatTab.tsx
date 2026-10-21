import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TripFlow } from '../about-me/TripFlow';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { Composer } from './Composer';
import {
  chatErrorKey,
  chatTransport,
  type GuestAnswerOutput,
  getChatHistory,
  hasGuestAnswer,
} from './chat-api';
import { MessageList } from './MessageList';
import type { CardAnswer } from './render/ConfirmationPart';
import { SavedPlacesProvider } from './render/SavedPlaces';
import { StarterCards } from './StarterCards';
import { TripCard } from './TripCard';
import { skipTripCard, tripCardKey } from './trip-card';
import { Welcome } from './Welcome';

type History =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'ready'; messages: UIMessage[] };

/** The Chat tab: loads the history once, then hands it to the conversation. */
export function ChatTab() {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [history, setHistory] = useState<History>({ status: 'loading' });

  const load = useCallback(() => {
    setHistory({ status: 'loading' });
    getChatHistory().then(
      ({ messages }) => setHistory({ status: 'ready', messages }),
      () => setHistory({ status: 'offline' }),
    );
  }, []);

  useEffect(() => {
    load();
    // Landing on the tab starts reading at its heading.
    heading.current?.focus();
  }, [load]);

  return (
    <section className="chat" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1} className="visually-hidden">
        {t('chat.title')}
      </h1>
      {history.status === 'ready' ? (
        <ChatView initial={history.messages} />
      ) : history.status === 'offline' ? (
        <div className="chat-offline">
          <MascotSays>{t('error.network')}</MascotSays>
          <button type="button" className="button" onClick={load}>
            {t('chat.retry')}
          </button>
        </div>
      ) : (
        <p className="status">{t('common.loading')}</p>
      )}
    </section>
  );
}

/** The conversation itself; `initial` must be the loaded history (useChat reads it once). */
export function ChatView({ initial }: { initial: UIMessage[] }) {
  const { t } = useTranslation();
  const { state } = useSpace();
  const space = state.status === 'ready' ? state.space : null;
  const { messages, sendMessage, status, error, setMessages, clearError, addToolOutput } = useChat({
    messages: initial,
    transport: chatTransport,
    // A tap on a booking card goes to the server by itself.
    sendAutomaticallyWhen: hasGuestAnswer,
  });
  const [draft, setDraft] = useState('');
  // The About me flow; once finished its thanks stay until the guest sends a message.
  const [flow, setFlow] = useState<'closed' | 'open' | 'done'>('closed');
  // The text last sent, so a failed turn can put it back.
  const pending = useRef('');
  // What the last request carried: a failed answer keeps the guest's message and the card.
  const lastRequest = useRef<'text' | 'answer'>('text');
  const busy = status === 'submitted' || status === 'streaming';
  const closed = space?.closed ?? true;

  const send = useCallback(
    (text: string) => {
      if (error) clearError();
      setFlow((f) => (f === 'done' ? 'closed' : f));
      lastRequest.current = 'text';
      pending.current = text;
      setDraft('');
      void sendMessage({ text });
    },
    [error, clearError, sendMessage],
  );

  // Confirm or Cancel on a card: the answer goes on the paused call until the server replies.
  const answer = useCallback(
    ({ toolName, toolCallId, action, content }: CardAnswer) => {
      if (error) clearError();
      lastRequest.current = 'answer';
      const output: GuestAnswerOutput = {
        kind: 'guest-answer',
        nonce: crypto.randomUUID(),
        action,
        ...(content ? { content } : {}),
      };
      void addToolOutput({ tool: toolName, toolCallId, output });
    },
    [error, clearError, addToolOutput],
  );

  // A failed turn stores nothing on the server: drop it here too and give the text back. A failed
  // answer stores nothing either; the card opens again for another tap.
  useEffect(() => {
    if (!error || lastRequest.current === 'answer') return;
    setMessages((current) => {
      const lastUser = current.findLastIndex((m) => m.role === 'user');
      return lastUser < 0 ? current : current.slice(0, lastUser);
    });
    setDraft((d) => d || pending.current);
  }, [error, setMessages]);

  // "Something else" on a choice card: the guest types their own answer.
  const focusComposer = useCallback(() => document.getElementById('chat-input')?.focus(), []);

  const errorKey = !error
    ? null
    : lastRequest.current === 'answer'
      ? 'booking.errorAnswer'
      : chatErrorKey(error);
  return (
    <div className="chat-view">
      <Welcome />
      {messages.length === 0 && !closed && space && (
        <>
          <StarterCards onSend={send} />
          {flow === 'closed' && (
            <TripCard
              storageKey={tripCardKey(space.unitSlug, space.closedAt)}
              onStart={() => {
                // The card does not come back on this device once the flow has opened.
                skipTripCard(tripCardKey(space.unitSlug, space.closedAt));
                setFlow('open');
              }}
            />
          )}
        </>
      )}
      {flow !== 'closed' && !closed && <TripFlow onFinish={() => setFlow('done')} />}
      <SavedPlacesProvider closed={closed}>
        <MessageList
          messages={messages}
          status={status}
          interactive={!busy && !closed}
          onSend={send}
          onSomethingElse={focusComposer}
          onAnswer={answer}
        />
      </SavedPlacesProvider>
      {errorKey && (
        <div className="chat-error" role="alert">
          <p>{t(errorKey)}</p>
          {errorKey !== 'chat.errorClosed' && errorKey !== 'booking.errorAnswer' && (
            <button type="button" className="text-button" onClick={() => send(pending.current)}>
              {t('chat.retry')}
            </button>
          )}
        </div>
      )}
      {closed ? (
        <p className="chat-closed">{t('chat.closed')}</p>
      ) : (
        <Composer value={draft} onChange={setDraft} onSend={send} busy={busy} />
      )}
    </div>
  );
}

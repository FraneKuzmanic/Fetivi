import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TripFlow } from '../about-me/TripFlow';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { Composer } from './Composer';
import { chatErrorKey, chatTransport, getChatHistory } from './chat-api';
import { MessageList } from './MessageList';
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
  const { messages, sendMessage, status, error, setMessages, clearError } = useChat({
    messages: initial,
    transport: chatTransport,
  });
  const [draft, setDraft] = useState('');
  // The About me flow; once finished its thanks stay until the guest sends a message.
  const [flow, setFlow] = useState<'closed' | 'open' | 'done'>('closed');
  // The text last sent, so a failed turn can put it back.
  const pending = useRef('');
  const busy = status === 'submitted' || status === 'streaming';
  const closed = space?.closed ?? true;

  const send = useCallback(
    (text: string) => {
      if (error) clearError();
      setFlow((f) => (f === 'done' ? 'closed' : f));
      pending.current = text;
      setDraft('');
      void sendMessage({ text });
    },
    [error, clearError, sendMessage],
  );

  // A failed turn stores nothing on the server: drop it here too and give the text back.
  useEffect(() => {
    if (!error) return;
    setMessages((current) => {
      const lastUser = current.findLastIndex((m) => m.role === 'user');
      return lastUser < 0 ? current : current.slice(0, lastUser);
    });
    setDraft((d) => d || pending.current);
  }, [error, setMessages]);

  // "Something else" on a choice card: the guest types their own answer.
  const focusComposer = useCallback(() => document.getElementById('chat-input')?.focus(), []);

  const errorKey = error ? chatErrorKey(error) : null;
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
        />
      </SavedPlacesProvider>
      {errorKey && (
        <div className="chat-error" role="alert">
          <p>{t(errorKey)}</p>
          {errorKey !== 'chat.errorClosed' && (
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

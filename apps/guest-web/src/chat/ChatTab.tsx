import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TripFlow } from '../about-me/TripFlow';
import { useEmail } from '../email/EmailProvider';
import { useInbox } from '../inbox/InboxProvider';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { Composer } from './Composer';
import {
  answerErrorKey,
  chatErrorKey,
  chatTransport,
  type GuestAnswerOutput,
  getChatHistory,
  hasGuestAnswer,
  type InboxEntry,
  splitInbox,
} from './chat-api';
import { asksToConfirm, MessageList } from './MessageList';
import type { CardAnswer } from './render/ConfirmationPart';
import { SavedPlacesProvider } from './render/SavedPlaces';
import { StarterCards } from './StarterCards';
import { TripCard } from './TripCard';
import { skipTripCard, tripCardKey } from './trip-card';
import { Welcome } from './Welcome';

type History =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'ready'; messages: UIMessage[]; inbox: InboxEntry[] };

/** The Chat tab: loads the history once, then hands it to the conversation. */
export function ChatTab() {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [history, setHistory] = useState<History>({ status: 'loading' });
  // The error of an answer that failed, told again once the chat has reloaded.
  const [failedAnswer, setFailedAnswer] = useState<Error | null>(null);
  const { markSeen } = useInbox();

  const load = useCallback(() => {
    setHistory({ status: 'loading' });
    getChatHistory().then(
      ({ messages }) => {
        const { chat, inbox } = splitInbox(messages);
        setHistory({ status: 'ready', messages: chat, inbox });
        // The guest now sees every inbox message: the badge counts from here.
        void markSeen();
      },
      () => setHistory({ status: 'offline' }),
    );
  }, [markSeen]);

  const reloadAfterAnswer = useCallback(
    (error: Error) => {
      setFailedAnswer(error);
      load();
    },
    [load],
  );

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
        <ChatView
          initial={history.messages}
          inbox={history.inbox}
          failedAnswer={failedAnswer}
          onAnswerFailed={reloadAfterAnswer}
          onInboxGrew={load}
        />
      ) : history.status === 'offline' ? (
        <div className="chat-offline">
          <MascotSays>{t('error.network')}</MascotSays>
          <button
            type="button"
            className="button"
            onClick={() => {
              setFailedAnswer(null);
              load();
            }}
          >
            {t('chat.retry')}
          </button>
        </div>
      ) : (
        <p className="status">{t('common.loading')}</p>
      )}
    </section>
  );
}

const ignore = () => {};

/** The conversation itself; `initial` must be the loaded history (useChat reads it once). */
export function ChatView({
  initial,
  inbox = [],
  failedAnswer = null,
  onAnswerFailed = ignore,
  onInboxGrew = ignore,
}: {
  initial: UIMessage[];
  /** Inbox messages from the loaded history; new ones arrive with a reload. */
  inbox?: InboxEntry[];
  /** An answer that failed before this history was loaded. */
  failedAnswer?: Error | null;
  /** A failed answer: the server may have stored it, so the history is loaded again. */
  onAnswerFailed?: (error: Error) => void;
  /** A new inbox message waits: the history is loaded again once the chat is idle. */
  onInboxGrew?: () => void;
}) {
  const { t } = useTranslation();
  const { state } = useSpace();
  const space = state.status === 'ready' ? state.space : null;
  const { messages, sendMessage, status, error, setMessages, clearError, addToolOutput } = useChat({
    messages: initial,
    transport: chatTransport,
    // A tap on a confirmation card goes to the server by itself.
    sendAutomaticallyWhen: hasGuestAnswer,
  });
  const [draft, setDraft] = useState('');
  // The About me flow; once finished its thanks stay until the guest sends a message.
  const [flow, setFlow] = useState<'closed' | 'open' | 'done'>('closed');
  // The text last sent, so a failed turn can put it back.
  const pending = useRef('');
  // What the last request carried: a failed answer reloads the history instead.
  const lastRequest = useRef<'text' | 'answer'>('text');
  // A tap on its way: once it is answered the card is gone, and focus must not fall to the page.
  const answering = useRef(false);
  const wasBusy = useRef(false);
  // What a failed answer left, read from the reloaded history; gone once the guest acts again.
  const [notice, setNotice] = useState(() =>
    failedAnswer ? answerErrorKey(failedAnswer, asksToConfirm(initial.at(-1))) : null,
  );
  const busy = status === 'submitted' || status === 'streaming';
  const closed = space?.closed ?? true;
  const { version } = useInbox();
  const refreshEmail = useEmail().refresh;
  const seenVersion = useRef(version);

  // A host reply arrived: show it once nothing is on its way.
  useEffect(() => {
    if (version === seenVersion.current || busy) return;
    seenVersion.current = version;
    onInboxGrew();
  }, [version, busy, onInboxGrew]);

  const send = useCallback(
    (text: string) => {
      if (error) clearError();
      setNotice(null);
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
      setNotice(null);
      lastRequest.current = 'answer';
      answering.current = true;
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
  // answer may have been stored before the stream broke: the stored state is shown again.
  useEffect(() => {
    if (!error) return;
    if (lastRequest.current === 'answer') {
      onAnswerFailed(error);
      return;
    }
    setMessages((current) => {
      const lastUser = current.findLastIndex((m) => m.role === 'user');
      return lastUser < 0 ? current : current.slice(0, lastUser);
    });
    setDraft((d) => d || pending.current);
  }, [error, setMessages, onAnswerFailed]);

  // "Something else" on a choice card: the guest types their own answer.
  const focusComposer = useCallback(() => document.getElementById('chat-input')?.focus(), []);

  // The answered card made way for a receipt or words: the guest carries on in the composer.
  useEffect(() => {
    const was = wasBusy.current;
    wasBusy.current = busy;
    if (!was || busy || !answering.current) return;
    answering.current = false;
    // A confirmed card may have given the Space its email.
    if (status === 'ready') refreshEmail();
    if (status === 'ready' && !asksToConfirm(messages.at(-1))) focusComposer();
  }, [busy, status, messages, focusComposer, refreshEmail]);

  // A failed answer unmounts this view while the history reloads.
  const errorKey = error && lastRequest.current === 'text' ? chatErrorKey(error) : notice;
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
          inbox={inbox}
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
          {error && errorKey !== 'chat.errorClosed' && (
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

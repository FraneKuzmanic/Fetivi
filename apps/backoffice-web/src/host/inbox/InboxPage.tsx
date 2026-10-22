import { useCallback, useEffect, useRef, useState } from 'react';
import { type HostMessage, host } from '../../api';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';
import { messageState, preview, receivedAt, STATE_CHIPS } from './format';
import { InboxMessage } from './InboxMessage';
import { inboxChanged } from './inbox-events';

/** New messages and reply deliveries show up without a reload (host email and push are ticket 24). */
const POLL_MS = 15_000;

/**
 * The Handoff inbox (PRD §6.6): the messages guests chose to send, translated into the host's
 * language, unread urgent ones first. Opening one marks it Read for the guest.
 */
export function InboxPage() {
  const { error, run } = useAction();
  const [messages, setMessages] = useState<HostMessage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const opened = useRef(new Set<string>());

  const load = useCallback(async () => {
    const { messages: list } = await host.inbox();
    const now = new Date().toISOString();
    // An admin acting as the host does not set Read on the server: what this page opened stays read.
    setMessages(
      list.map((m) => (m.readAt || !opened.current.has(m.id) ? m : { ...m, readAt: now })),
    );
  }, []);

  useEffect(() => {
    void run(load);
  }, [run, load]);

  useEffect(() => {
    const timer = setInterval(() => {
      // A failed background refresh is ignored; the next tick tries again.
      load().then(inboxChanged, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const open = useCallback((m: HostMessage) => {
    setSelected(m.id);
    if (m.readAt || opened.current.has(m.id)) return;
    opened.current.add(m.id);
    // The API ignores it for an admin acting as the host; the page shows it read either way.
    void host.readMessage(m.id).then(inboxChanged, () => opened.current.delete(m.id));
    const now = new Date().toISOString();
    setMessages((list) => list?.map((x) => (x.id === m.id ? { ...x, readAt: now } : x)) ?? list);
  }, []);

  const replace = (updated: HostMessage) => {
    setMessages((list) => list?.map((x) => (x.id === updated.id ? updated : x)) ?? list);
    inboxChanged();
  };

  const several = new Set(messages?.map((m) => m.propertyName)).size > 1;
  const current = messages?.find((m) => m.id === selected) ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Inbox</h1>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {messages === null && !error ? <p className="muted">Loading…</p> : null}
      {messages?.length === 0 ? (
        <p className="muted">
          No guest messages yet. Guests can message you from the chat; you'll see them here.
        </p>
      ) : null}
      {messages && messages.length > 0 ? (
        <div className="inbox-layout" data-open={current ? 'true' : undefined}>
          <ul className="rows inbox-list" aria-label="Guest messages">
            {messages.map((m) => {
              const state = messageState(m);
              const chip = STATE_CHIPS[state];
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="row-link inbox-row"
                    data-unread={state === 'new' ? 'true' : undefined}
                    aria-current={m.id === selected ? 'true' : undefined}
                    onClick={() => open(m)}
                  >
                    <span className="inbox-row-top">
                      <span className="inbox-row-unit">
                        {several ? `${m.propertyName} · ${m.unitName}` : m.unitName}
                      </span>
                      <span className="muted inbox-row-time">{receivedAt(m.sentAt)}</span>
                    </span>
                    <span className="inbox-row-preview">{preview(m)}</span>
                    <span className="inbox-row-meta">
                      <span className="muted">{dateRange(m.checkIn, m.checkout)}</span>
                      <span className="chips">
                        {m.urgency === 'urgent' ? <span className="chip fail">Urgent</span> : null}
                        <span className={`chip ${chip.tone}`}>{chip.label}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {current ? (
            <InboxMessage
              key={current.id}
              message={current}
              several={several}
              onBack={() => setSelected(null)}
              onReplied={replace}
            />
          ) : (
            <p className="muted inbox-empty-detail">Choose a message to read it and reply.</p>
          )}
        </div>
      ) : null}
    </>
  );
}

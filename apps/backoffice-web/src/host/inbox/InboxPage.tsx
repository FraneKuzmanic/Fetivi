import type { HandoffReason } from '@fetivi/domain/handoff-vocabulary';
import {
  ChatCircleText,
  type Icon,
  Question,
  Receipt,
  UserCircle,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { type HostMessage, type HostOrder, host } from '../../api';
import { EmptyState } from '../../shell/EmptyState';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';
import { messageState, preview, receivedAt, STATE_CHIPS } from './format';
import { InboxMessage } from './InboxMessage';
import { inboxChanged, onPushMessage } from './inbox-events';
import { OrdersSection } from './OrdersSection';

/** Why the guest wrote, at a glance. */
const REASON_ICONS: Record<HandoffReason, Icon> = {
  property_question: Question,
  problem: Warning,
  request: Wrench,
  guest_asked: UserCircle,
};

/** New messages and reply deliveries show up without a reload; a push on this phone also reloads. */
const POLL_MS = 15_000;

/**
 * The Handoff inbox (PRD §6.6): the messages guests chose to send, translated into the host's
 * language, unread urgent ones first. Opening one marks it Read for the guest. Orders on the
 * host's own services come first, with their one-tap answers (38).
 */
export function InboxPage() {
  const { error, run } = useAction();
  const [messages, setMessages] = useState<HostMessage[] | null>(null);
  const [orders, setOrders] = useState<HostOrder[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const opened = useRef(new Set<string>());
  const [params, setParams] = useSearchParams();
  const linked = params.get('message');
  const asked = params.get('tab');

  const load = useCallback(async () => {
    const { messages: list, orders: own } = await host.inbox();
    setOrders(own);
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
    const stop = onPushMessage(() => {
      load().then(inboxChanged, () => {});
    });
    return () => {
      clearInterval(timer);
      stop();
    };
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

  // An email or push link (`/inbox?message=<id>`) opens that message once; an unknown id is ignored.
  useEffect(() => {
    if (!linked || messages === null) return;
    const m = messages.find((x) => x.id === linked);
    if (m) open(m);
    setParams(
      (prev) => {
        prev.delete('message');
        return prev;
      },
      { replace: true },
    );
  }, [linked, messages, open, setParams]);

  const replace = (updated: HostMessage) => {
    setMessages((list) => list?.map((x) => (x.id === updated.id ? updated : x)) ?? list);
    inboxChanged();
  };

  const several = new Set(messages?.map((m) => m.propertyName)).size > 1;
  const current = messages?.find((m) => m.id === selected) ?? null;

  const unread = messages?.filter((m) => messageState(m) === 'new').length ?? 0;
  const waiting = orders.filter((o) => o.waiting).length;
  // Orders waiting for an answer open first; otherwise the messages.
  const tab = asked === 'orders' || (asked === null && waiting > 0) ? 'orders' : 'messages';
  const showTab = (next: 'messages' | 'orders') =>
    setParams(next === 'messages' ? {} : { tab: next }, { replace: true });

  return (
    <>
      <div className="page-head">
        <h1>Inbox</h1>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {messages === null && !error ? <p className="muted">Loading…</p> : null}
      {messages !== null && orders.length > 0 ? (
        <div className="tabs" role="tablist" aria-label="Inbox">
          <button
            type="button"
            role="tab"
            className="tab-link"
            aria-selected={tab === 'messages'}
            aria-current={tab === 'messages' ? 'page' : undefined}
            onClick={() => showTab('messages')}
          >
            <ChatCircleText aria-hidden="true" />
            Guest messages
            {unread > 0 ? <span className="tab-count">{unread}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            className="tab-link"
            aria-selected={tab === 'orders'}
            aria-current={tab === 'orders' ? 'page' : undefined}
            onClick={() => showTab('orders')}
          >
            <Receipt aria-hidden="true" />
            Orders
            {waiting > 0 ? <span className="tab-count">{waiting}</span> : null}
          </button>
        </div>
      ) : null}
      {tab === 'orders' && orders.length > 0 ? (
        <OrdersSection orders={orders} onChanged={load} />
      ) : null}
      {tab === 'messages' && messages?.length === 0 ? (
        <EmptyState icon={ChatCircleText} title="No guest messages yet">
          When a guest sends you a message from the chat, it shows up here, translated into your
          language.
        </EmptyState>
      ) : null}
      {tab === 'messages' && messages && messages.length > 0 ? (
        <div className="inbox-layout" data-open={current ? 'true' : undefined}>
          <ul className="rows inbox-list" aria-label="Guest messages">
            {messages.map((m) => {
              const state = messageState(m);
              const chip = STATE_CHIPS[state];
              const Reason = REASON_ICONS[m.reason];
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="row-link inbox-row"
                    data-unread={state === 'new' ? 'true' : undefined}
                    aria-current={m.id === selected ? 'true' : undefined}
                    onClick={() => open(m)}
                  >
                    <span className={`inbox-row-icon ${m.urgency}`} aria-hidden="true">
                      <Reason />
                    </span>
                    <span className="inbox-row-main">
                      <span className="inbox-row-top">
                        <span className="inbox-row-unit">
                          {state === 'new' ? (
                            <span className="unread-dot" aria-hidden="true" />
                          ) : null}
                          {[
                            m.bookerName,
                            several ? `${m.propertyName} · ${m.unitName}` : m.unitName,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <span className="muted inbox-row-time">{receivedAt(m.sentAt)}</span>
                      </span>
                      <span className="inbox-row-preview">{preview(m)}</span>
                      <span className="inbox-row-meta">
                        <span className="muted">{dateRange(m.checkIn, m.checkout)}</span>
                        <span className="chips">
                          {m.urgency === 'urgent' ? (
                            <span className="chip fail">Urgent</span>
                          ) : null}
                          <span className={`chip ${chip.tone}`}>{chip.label}</span>
                        </span>
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

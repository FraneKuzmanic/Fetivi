// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HostMessageDraftPayload } from '../payloads';
import { HostDraftCard, type HostDraftLabels } from './host-draft-card/HostDraftCard';
import { HostMessageSent, type HostSentLabels } from './host-draft-card/HostMessageSent';

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};
const area = () => {
  const found = host.querySelector('textarea');
  if (!found) throw new Error('no textarea');
  return found;
};
const type = (el: HTMLTextAreaElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const submit = () =>
  act(() => {
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

const DRAFT: HostMessageDraftPayload = {
  pendingId: 'p-1',
  messageId: 'm-1',
  text: 'The shower has no hot water.',
  reason: 'problem',
  urgency: 'urgent',
  language: 'en',
};

const LABELS: HostDraftLabels = {
  heading: 'Message to your host',
  explain: 'Fetivi translates it for your host. Nothing is sent until you tap Send.',
  label: 'Your message',
  counter: (count, max) => `${count} of ${max}`,
  empty: 'Write a few words for your host.',
  urgent: 'Marked urgent',
  send: 'Send',
  cancel: 'Not now',
  sending: 'Sending…',
};

const SENT_LABELS: HostSentLabels = {
  heading: 'Message to your host',
  sentAt: () => 'Sent · 14:05',
  read: 'Read',
  urgent: 'Urgent',
};

function card(state: 'open' | 'sending' = 'open', draft = DRAFT) {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  mount(
    <HostDraftCard
      draft={draft}
      state={state}
      onSend={onSend}
      onCancel={onCancel}
      labels={LABELS}
    />,
  );
  return { onSend, onCancel };
}

describe('HostDraftCard', () => {
  it('prefills the stored draft in a labelled field with a counter', () => {
    card();
    const field = area();
    expect(field.value).toBe(DRAFT.text);
    expect(field.maxLength).toBe(1000);
    expect(host.querySelector(`label[for="${field.id}"]`)?.textContent).toBe('Your message');
    const counter = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(counter?.textContent).toBe(`${DRAFT.text.length} of 1000`);
    expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
      host.querySelector('h3')?.id,
    );
    expect(host.textContent).toContain('Marked urgent');
    expect(document.activeElement).not.toBe(field);
  });

  it('sends the guest’s edited text', () => {
    const { onSend } = card();
    type(area(), '  No hot water since 8 this morning.  ');
    expect(host.textContent).toContain('38 of 1000');
    submit();
    expect(onSend).toHaveBeenCalledWith('No hot water since 8 this morning.');
  });

  it('shows an error tied to the field for an empty message and sends nothing', () => {
    const { onSend } = card();
    type(area(), '   ');
    submit();
    expect(onSend).not.toHaveBeenCalled();
    const field = area();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const [errorId] = (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(document.getElementById(errorId ?? '')?.textContent).toBe(LABELS.empty);
    // Typing again clears the error before the next Send.
    type(field, 'No hot water');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(host.textContent).not.toContain(LABELS.empty);
  });

  it('Not now cancels; sending disables everything and says so', () => {
    const { onCancel } = card();
    act(() => button('Not now').click());
    expect(onCancel).toHaveBeenCalledOnce();
    act(() => root?.unmount());
    card('sending', { ...DRAFT, urgency: 'normal' });
    expect(area().disabled).toBe(true);
    expect(button('Send').disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Sending…');
    expect(host.textContent).not.toContain('Marked urgent');
  });
});

describe('HostMessageSent', () => {
  const message = {
    id: 'm-1',
    text: 'No hot water',
    urgency: 'normal' as const,
    sentAt: '2026-10-22T12:05:00Z',
  };

  it('shows Sent, then Read, never "seen"', () => {
    mount(<HostMessageSent message={message} status="sent" labels={SENT_LABELS} />);
    expect(host.textContent).toContain('No hot water');
    expect(host.textContent).toContain('Sent · 14:05');
    act(() =>
      root?.render(<HostMessageSent message={message} status="read" labels={SENT_LABELS} />),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Read');
    expect(host.textContent?.toLowerCase()).not.toContain('seen');
  });
});

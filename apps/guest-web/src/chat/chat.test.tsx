import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import type { UIMessage } from 'ai';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Space } from '../api';
import { locales, setLanguage } from '../i18n';
import { SpaceProvider } from '../space';
import { ChatView } from './ChatTab';
import { sendsOnKey } from './Composer';
import { chatErrorKey, lastUserText, messageText } from './chat-api';
import { tripCardSkipped } from './trip-card';

afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

const space = (closed = false): Space => ({
  language: 'en',
  closedAt: '2026-10-26T23:00:00.000Z',
  closed,
  unitSlug: 'qrabc',
  keepForEvaluation: false,
});

const render = (initial: UIMessage[], closed = false) =>
  renderToString(
    <MemoryRouter>
      <SpaceProvider initial={{ status: 'ready', space: space(closed) }}>
        <ChatView initial={initial} />
      </SpaceProvider>
    </MemoryRouter>,
  );

const msg = (id: string, role: 'user' | 'assistant', text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
});

const STARTERS = [
  "What's the Wi-Fi password?",
  'When are check-in and checkout?',
  'How do I get in?',
  'What are the house rules?',
  "What's good to do around here?",
];

// renderToString escapes apostrophes and quotes.
const html = (text: string) => text.replaceAll("'", '&#x27;').replaceAll('"', '&quot;');

describe('ChatView', () => {
  it('opens with the welcome, five starter questions in order and the trip card', () => {
    const out = render([]);
    expect(out).toContain(html(locales.en.chat.welcome));
    expect(out).toContain('the AI assistant');
    const starters = [...out.matchAll(/<button type="button" class="starter">(.*?)<\/button>/g)];
    expect(starters.map((m) => m[1]?.replace(/<svg.*<\/svg>/, ''))).toEqual(STARTERS.map(html));
    expect(out).toContain('Tell me about your trip');
    expect(out).toContain('>Skip<');
    expect(out).toContain('role="log"');
    // Start opens the About me flow; it sends no chat message.
    expect(out).not.toContain('trip-flow');
  });

  it('welcomes in every guest language', () => {
    for (const language of GUEST_LANGUAGES) {
      setLanguage(language);
      expect(render([]), language).toContain(html(locales[language].chat.welcome));
    }
  });

  it('shows the history in order with hidden speaker labels, and no starters', () => {
    const out = render([
      msg('1', 'user', 'Where is the key?'),
      msg('2', 'assistant', 'Under the mat.'),
    ]);
    const user = out.indexOf('Where is the key?');
    const answer = out.indexOf('Under the mat.');
    expect(user).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(user);
    expect(out).toContain('<span class="visually-hidden">You: </span>Where is the key?');
    expect(out).toContain('<span class="visually-hidden">Fetivi: </span>Under the mat.');
    expect(out).not.toContain('class="starter"');
    expect(out).not.toContain('trip-card');
    expect(out).toMatch(/role="log" aria-live="off"/);
    expect(out).toMatch(/role="status" aria-live="polite"/);
  });

  it('is read-only for a closed space', () => {
    const out = render([msg('1', 'user', 'Hi')], true);
    expect(out).not.toContain('<textarea');
    // The last read-only day (closedAt + 30 days, minus a moment) in the device's clock.
    const lastDay = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(
      new Date(Date.parse(space().closedAt) + 30 * 86_400_000 - 1),
    );
    expect(lastDay).toMatch(/^November 2[56], 2026$/);
    expect(out).toContain(
      `Your stay has ended. You can read this chat and use My trip until ${lastDay}.`,
    );
    expect(out).toContain('href="/trip"');
    expect(out).toContain('class="mascot-says"');
    expect(out).not.toContain('class="starter"');
    expect(render([], true)).not.toContain('trip-card');
  });

  it('has a labelled text box that is never disabled, and a named send button', () => {
    const out = render([]);
    const textarea = /<textarea[^>]*>/.exec(out)?.[0] ?? '';
    expect(textarea).toContain('id="chat-input"');
    expect(textarea).toMatch(/enterkeyhint="send"/i);
    expect(textarea).not.toMatch(/disabled|readonly/i);
    expect(out).toContain('<label for="chat-input" class="visually-hidden">Message Fetivi</label>');
    expect(out).toMatch(/<button type="submit" class="send-button"[^>]*>.*Send<\/span><\/button>/);
  });
});

describe('chat helpers', () => {
  it('joins text parts and finds the newest guest text', () => {
    const multi: UIMessage = {
      id: 'x',
      role: 'user',
      parts: [{ type: 'text', text: 'one' }, { type: 'step-start' }, { type: 'text', text: 'two' }],
    };
    expect(messageText(multi)).toBe('one\ntwo');
    expect(lastUserText([msg('1', 'user', 'old'), msg('2', 'assistant', 'a'), multi])).toBe(
      'one\ntwo',
    );
    expect(lastUserText([msg('2', 'assistant', 'a')])).toBe('');
  });

  it('maps errors to messages', () => {
    expect(chatErrorKey(new Error('{"error":"space-closed"}'))).toBe('chat.errorClosed');
    expect(chatErrorKey(new Error('{"error":"turn-in-progress"}'))).toBe('chat.errorBusy');
    expect(chatErrorKey(new Error('{"error":"message-cap"}'))).toBe('chat.errorCap');
    expect(chatErrorKey(new Error('turn-failed'))).toBe('chat.errorTurn');
    expect(chatErrorKey(new Error('Failed to fetch'))).toBe('chat.errorTurn');
  });

  it('sends on Enter, but not on Shift+Enter or while composing', () => {
    const key = (k: string, shiftKey = false, isComposing = false) =>
      sendsOnKey({ key: k, shiftKey, isComposing });
    expect(key('Enter')).toBe(true);
    expect(key('Enter', true)).toBe(false);
    expect(key('Enter', false, true)).toBe(false);
    expect(key('a')).toBe(false);
  });

  it('treats unavailable storage as a trip card not skipped', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(tripCardSkipped('k')).toBe(false);
  });
});

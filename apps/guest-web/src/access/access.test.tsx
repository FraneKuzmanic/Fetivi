import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { Space } from '../api';
import { i18next, setLanguage } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { entryDecision, guardDecision, type SpaceState } from '../space';
import { LanguagePicker } from './LanguagePicker';
import { NoLinkPage } from './NoLinkPage';
import { formatWait, PinForm, pinMessage } from './PinForm';

afterEach(() => setLanguage('en'));

const ready = (unitSlug: string): SpaceState => ({
  status: 'ready',
  space: { language: 'en', closedAt: '2026-10-24T22:00:00.000Z', closed: false, unitSlug } as Space,
});

/** The option buttons in document order, each with its HTML. */
const optionButtons = (html: string) =>
  [...html.matchAll(/<button[^>]*class="language-option"[^>]*>(.*?)<\/button>/g)].map((m) => m[0]);

describe('LanguagePicker', () => {
  it('lists the seven languages under their own names in a fixed order and marks the phone language', () => {
    const html = renderToString(<LanguagePicker browserLanguages={['de-AT']} onPick={() => {}} />);
    const buttons = optionButtons(html);
    expect(buttons).toHaveLength(7);
    GUEST_LANGUAGES.forEach((code, i) => {
      expect(buttons[i]).toContain(`<span lang="${code}">${LANGUAGE_NAMES[code]}</span>`);
    });
    const marked = buttons.filter((b) => b.includes('data-suggested="true"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('lang="de"');
    expect(marked[0]).toContain('Your phone&#x27;s language');
    expect(html).toContain('Which language should we talk in?');
  });

  it('marks English when the phone speaks none of our languages', () => {
    const html = renderToString(<LanguagePicker browserLanguages={['es']} onPick={() => {}} />);
    const marked = optionButtons(html).filter((b) => b.includes('data-suggested="true"'));
    expect(marked[0]).toContain('lang="en"');
  });
});

describe('PinForm', () => {
  it('is one labelled numeric input with a live message region', () => {
    const html = renderToString(
      <PinForm slug="abc" language="en" onEntered={() => {}} onChangeLanguage={() => {}} />,
    );
    expect(html).toContain('<label for="pin">PIN</label>');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Change language');
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
  });

  it('shows strings in the chosen language', () => {
    setLanguage('hr');
    const html = renderToString(
      <PinForm slug="abc" language="hr" onEntered={() => {}} onChangeLanguage={() => {}} />,
    );
    expect(html).toContain('Unesite PIN');
  });

  it('counts the wait down in the message and drops it when the wait ends', () => {
    const t = i18next.t;
    const wrong = "That PIN doesn't match. Check your host's message and try again.";
    expect(pinMessage(t, 'wrong', 30)).toBe(`${wrong} Too many tries. You can try again in 0:30.`);
    expect(pinMessage(t, 'wrong', 12)).toBe(`${wrong} Too many tries. You can try again in 0:12.`);
    expect(pinMessage(t, 'wrong', 0)).toBe(wrong);
    expect(pinMessage(t, 'wait', 75)).toBe('Too many tries. You can try again in 1:15.');
    expect(pinMessage(t, 'wait', 0)).toBe('');
    expect(pinMessage(t, null, 0)).toBe('');
  });

  it('keeps the countdown out of the live region, which speaks once per attempt', () => {
    const html = renderToString(
      <PinForm slug="abc" language="en" onEntered={() => {}} onChangeLanguage={() => {}} />,
    );
    expect(html).toContain('<p id="pin-message" class="message">');
    expect(html).toContain('<p class="visually-hidden" role="status">');
  });

  it('formats waits as minutes and seconds', () => {
    expect(formatWait(0)).toBe('0:00');
    expect(formatWait(30)).toBe('0:30');
    expect(formatWait(75)).toBe('1:15');
    expect(formatWait(900)).toBe('15:00');
  });
});

describe('entryDecision', () => {
  it('opens the shell only for a space of the same unit', () => {
    expect(entryDecision({ status: 'loading' }, 'abc')).toBe('loading');
    expect(entryDecision({ status: 'none' }, 'abc')).toBe('access');
    expect(entryDecision(ready('abc'), 'abc')).toBe('shell');
    expect(entryDecision(ready('abc'), 'other')).toBe('access');
  });
});

describe('guardDecision', () => {
  it('allows tab routes only with a space', () => {
    expect(guardDecision({ status: 'loading' })).toBe('loading');
    expect(guardDecision({ status: 'none' })).toBe('no-link');
    expect(guardDecision(ready('abc'))).toBe('allow');
    expect(guardDecision({ status: 'offline' })).toBe('offline');
  });

  it('keeps the unit link usable when the space could not be loaded', () => {
    expect(entryDecision({ status: 'offline' }, 'abc')).toBe('access');
  });
});

describe('NoLinkPage', () => {
  it('says the connection failed instead of asking for the link when offline', () => {
    const html = renderToString(<NoLinkPage reason="offline" />);
    expect(html).toContain('No connection.');
    expect(html).not.toContain('Open the link your host sent you');
  });

  it('marks its own step so the stage is centred like the welcome', () => {
    const html = renderToString(<NoLinkPage />);
    expect(html).toContain('<main class="onboarding" data-step="no-link">');
  });
});

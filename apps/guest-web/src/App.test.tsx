import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import type { Space } from './api';
import type { SpaceState } from './space';

const render = (path: string, initial?: SpaceState) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App initial={initial} />
    </MemoryRouter>,
  );

const ready: SpaceState = {
  status: 'ready',
  space: {
    language: 'en',
    closedAt: '2026-10-24T22:00:00.000Z',
    closed: false,
    unitSlug: 'abc',
  } satisfies Space,
};

const CHAT_TEXT = 'This is where we&#x27;ll chat.';
const NO_LINK = 'Open the link your host sent you';

// AC8: without a valid space, nothing beyond the picker and the PIN screen is reachable.
describe('guest-web App', () => {
  it('shows no tab content while the space is still loading', () => {
    for (const path of ['/chat', '/guide', '/trip', '/']) {
      const html = render(path);
      expect(html).not.toContain(CHAT_TEXT);
      expect(html).not.toContain('<nav');
      expect(html).toContain('Loading');
    }
    expect(render('/anything')).toContain(NO_LINK);
  });

  it('shows only the "open your link" screen without a space', () => {
    for (const path of ['/chat', '/guide', '/trip', '/', '/preview', '/anything']) {
      const html = render(path, { status: 'none' });
      expect(html).toContain(NO_LINK);
      expect(html).not.toContain('<nav');
      expect(html).not.toContain('<a ');
    }
  });

  it('opens the unit link on the language picker', () => {
    expect(render('/u/abc')).toContain('Choose your language');
    expect(render('/u/abc', { status: 'none' })).toContain('Choose your language');
  });

  it('opens the shell with a space', () => {
    const html = render('/chat', ready);
    expect(html).toContain(CHAT_TEXT);
    expect(html).toContain('<nav');
  });

  it('asks for the PIN of another unit even with a space', () => {
    const html = render('/u/other', ready);
    expect(html).toContain('Choose your language');
    expect(html).not.toContain('<nav');
  });
});

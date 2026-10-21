import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { SpaceProvider } from '../space';
import { Shell } from './Shell';

afterEach(() => setLanguage('en'));

const render = (path: string, unread = 0) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <SpaceProvider initial={{ status: 'none' }}>
        <Shell tab={path.slice(1) as 'chat' | 'guide' | 'trip'} unread={unread} />
      </SpaceProvider>
    </MemoryRouter>,
  );

const links = (html: string) =>
  [...html.matchAll(/<a [^>]*class="tab[^"]*"[^>]*>/g)].map((m) => m[0]);

describe('Shell', () => {
  it('has three tabs with the current one marked, and the header before main before the tabs', () => {
    const html = render('/guide');
    const tabs = links(html);
    expect(tabs).toHaveLength(3);
    expect(tabs.map((a) => /href="([^"]+)"/.exec(a)?.[1])).toEqual(['/chat', '/guide', '/trip']);
    expect(tabs.filter((a) => a.includes('aria-current="page"'))).toEqual([
      expect.stringContaining('href="/guide"'),
    ]);
    expect(html).toContain('My trip');
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
    expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<nav'));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toMatch(
      /<a [^>]*href="\/about-me"[^>]*>.*?<span class="visually-hidden">About me<\/span><\/a>/,
    );
  });

  it('renders a page that is not a tab with no tab marked', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/about-me']}>
        <SpaceProvider initial={{ status: 'none' }}>
          <Shell>
            <p>page body</p>
          </Shell>
        </SpaceProvider>
      </MemoryRouter>,
    );
    expect(html).toContain('<main id="main" class="shell-main"><p>page body</p></main>');
    expect(links(html).filter((a) => a.includes('aria-current="page"'))).toEqual([]);
  });

  it('shows the Chat badge only with unread messages', () => {
    expect(render('/chat')).not.toContain('class="badge"');
    const html = render('/chat', 3);
    expect(html).toContain('class="badge"');
    expect(html).toContain('3 unread');
  });

  it('speaks the interface language', () => {
    setLanguage('de');
    const html = render('/trip');
    expect(html).toContain('Meine Reise');
    expect(html).toContain('Reiseführer');
    expect(html).toContain('<span lang="de">Deutsch</span>');
  });
});

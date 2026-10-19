import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const render = (path: string) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe('backoffice-web App', () => {
  it('renders the login page with the wordmark', () => {
    const html = render('/login');
    expect(html).toContain('Fetivi');
    expect(html).toContain('Back office');
    expect(html).toContain('Log in');
  });

  it('shows the password hint on sign-up', () => {
    expect(render('/sign-up')).toContain('at least 10 characters');
  });

  it('treats a reset link without a token as invalid', () => {
    expect(render('/reset-password')).toContain('This link is invalid or has expired.');
  });

  it('waits for the session before showing a protected page', () => {
    expect(render('/')).toContain('Loading');
  });
});

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('backoffice-web App', () => {
  it('renders the wordmark', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Fetivi');
    expect(html).toContain('Back office');
  });
});

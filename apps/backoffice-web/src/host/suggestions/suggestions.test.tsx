// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import type { HostSuggestion, Me } from '../../api';

const SUGGESTION: HostSuggestion = {
  id: 'g1',
  unitId: 'u1',
  unitName: 'Apartment Mare',
  propertyName: 'Villa Mare',
  topic: 'laundry',
  stayCount: 3,
  text: 'Guests in 3 stays asked about “Laundry”, and Fetivi had no answer.',
  wizardPath: '/units/u1/setup/how_tos#field-laundry',
  createdAt: '2026-10-20T10:00:00.000Z',
};

const HOST_ME: Me = {
  account: { id: 'h1', email: 'host@example.test', role: 'host', language: 'en' },
  actingAs: null,
};

let root: Root | null = null;
let el: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(suggestions: Response) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/me') return json(HOST_ME);
    if (url === '/api/host/inbox')
      return json({ messages: [], unread: 0, orders: [], ordersWaiting: 0 });
    if (url === '/api/host/suggestions') return suggestions;
    return new Response(null, { status: 404 });
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/suggestions']}>
        <App />
      </MemoryRouter>,
    );
  });
  await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('Suggestions'));
}

const text = () => el.textContent ?? '';

describe('SuggestionsPage', () => {
  it("shows Fetivi's sentence, the unit, and a link to the wizard field", async () => {
    await mount(json({ suggestions: [SUGGESTION] }));
    await vi.waitFor(() => expect(text()).toContain(SUGGESTION.text));
    expect(text()).toContain('Villa Mare · Apartment Mare');
    expect(text()).toContain('You never see what guests wrote.');
    const link = el.querySelector('a[href="/units/u1/setup/how_tos#field-laundry"]');
    expect(link?.textContent).toBe('Add it in setup');
    // AC 4: one row of API fields only, no transcript or message UI.
    expect(el.querySelectorAll('.rows > li')).toHaveLength(1);
    expect(el.querySelector('.rows')?.textContent).toBe(
      `${SUGGESTION.text}Villa Mare · Apartment MareAdd it in setup`,
    );
  });

  it('has a Suggestions item in the host nav', async () => {
    await mount(json({ suggestions: [] }));
    const labels = (nav: string) =>
      [...el.querySelectorAll(`${nav} a`)].map((a) => a.textContent?.trim());
    expect(labels('.side-nav')).toContain('Suggestions');
    // A sixth of a phone's width does not fit "Suggestions".
    expect(labels('.bottom-nav')).toContain('To add');
    expect(labels('.bottom-nav')).not.toContain('Suggestions');
  });

  it('says so when nothing is missing', async () => {
    await mount(json({ suggestions: [] }));
    await vi.waitFor(() => expect(text()).toContain('Nothing missing right now.'));
    expect(el.querySelector('.rows')).toBeNull();
  });

  it('shows an error when the list cannot load', async () => {
    await mount(json({ error: 'internal' }, 500));
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')).not.toBeNull());
  });
});

// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StayProposal, StayProposals } from '../../../api';
import { messageFor } from '../../../messages';
import { BookingLinksStep } from './BookingLinksStep';
import { ConfirmProposalPage } from './ConfirmProposalPage';
import { ProposedList } from './ProposedList';

const MERGED: StayProposal = {
  id: 'e1',
  unitId: 'u1',
  unitName: 'A1',
  propertyId: 'p1',
  propertyName: 'Villa Mare',
  timezone: 'Europe/Zagreb',
  checkIn: '2026-10-24',
  checkout: '2026-10-27',
  sources: ['airbnb', 'booking'],
  summaries: [
    { source: 'airbnb', summary: 'Reserved' },
    { source: 'booking', summary: 'CLOSED - Not available' },
  ],
  pinWarning: false,
};

const SOON: StayProposal = {
  ...MERGED,
  id: 'e2',
  checkIn: '2026-10-20',
  checkout: '2026-10-22',
  sources: ['booking'],
  summaries: [{ source: 'booking', summary: 'CLOSED - Not available' }],
  pinWarning: true,
};

let root: Root | null = null;
let calls: { url: string; method: string; body: unknown }[] = [];

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

function stubApi(options: { proposals?: StayProposal[]; confirm?: Response } = {}) {
  calls = [];
  let proposals = options.proposals ?? [MERGED, SOON];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/host/stay-proposals') && method === 'GET') {
        const data: StayProposals = {
          proposals,
          bookingLinks: { domain: 'guest.fetivi.test', pending: [] },
        };
        return json(data);
      }
      const dismissed = /stay-proposals\/(\w+)\/dismiss$/.exec(url);
      if (dismissed) {
        proposals = proposals.filter((p) => p.id !== dismissed[1]);
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/confirm')) return options.confirm ?? json({ id: 's1' }, 201);
      if (url.endsWith('/booking-links-approved')) return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    }),
  );
}

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

async function mount(path: string, element: React.ReactNode, route = path) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
          <Route path="/stays/:id" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;

async function click(target: HTMLButtonElement | undefined) {
  if (!target) throw new Error('no such button');
  await act(async () => target.click());
}

async function type(element: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(element) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('ProposedList', () => {
  it('shows a merged proposal with both source chips and warns about a close check-in', async () => {
    stubApi();
    const onWarned = vi.fn();
    await mount('/stays', <ProposedList several={false} onWarned={onWarned} />, '/stays');
    expect(onWarned).toHaveBeenLastCalledWith(1);
    expect(document.querySelector('.warning')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('To confirm (2)');
    const rows = document.querySelectorAll('.proposal-row');
    expect(rows).toHaveLength(2);
    const chips = [...(rows[0]?.querySelectorAll('.chip') ?? [])].map((c) => c.textContent);
    expect(chips).toEqual(['Airbnb', 'Booking.com']);
    expect(rows[0]?.textContent).toContain('Airbnb: Reserved');
    expect(rows[1]?.textContent).toContain('Check-in soon');
    expect(rows[1]?.querySelector('.proposal-summary')?.textContent).toBe('CLOSED - Not available');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe('/stays/proposed/e1');
  });

  it('dismisses after the confirm dialog and reloads', async () => {
    stubApi();
    await mount('/stays', <ProposedList several={false} />, '/stays');
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    await click(button('Not a booking'));
    expect(calls.some((c) => c.url.endsWith('/dismiss'))).toBe(false);
    confirm.mockReturnValue(true);
    await click(button('Not a booking'));
    expect(confirm).toHaveBeenLastCalledWith(
      'Not a booking? Fetivi will not propose this calendar entry again.',
    );
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/host/stay-proposals/e1/dismiss',
    ]);
    expect(document.querySelectorAll('.proposal-row')).toHaveLength(1);
  });

  it('renders nothing when there is nothing to confirm', async () => {
    stubApi({ proposals: [] });
    await mount('/stays', <ProposedList several={false} />, '/stays');
    expect(document.body.textContent).toBe('');
  });
});

describe('ConfirmProposalPage', () => {
  it('posts the party and lands on the PIN screen', async () => {
    stubApi();
    await mount('/stays/proposed/e1', <ConfirmProposalPage />, '/stays/proposed/:id');
    expect(document.body.textContent).toContain('from the Airbnb and Booking.com calendars');
    const guests = document.querySelector<HTMLInputElement>('input[type="number"]');
    if (!guests) throw new Error('no guests field');
    expect(guests.value).toBe('');
    expect(guests.required).toBe(true);
    await type(guests, '3');
    await click(button('Confirm and get PIN'));
    expect(calls.find((c) => c.url.endsWith('/confirm'))).toEqual({
      url: '/api/host/stay-proposals/e1/confirm',
      method: 'POST',
      body: { partySize: 3, bookerName: null, reservationNumber: null, handoverLanguage: 'en' },
    });
    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe('/stays/s1?new=1');
  });

  it('shows why a confirm failed', async () => {
    stubApi({ confirm: json({ error: 'proposal-gone' }, 409) });
    await mount('/stays/proposed/e1', <ConfirmProposalPage />, '/stays/proposed/:id');
    const guests = document.querySelector<HTMLInputElement>('input[type="number"]');
    if (!guests) throw new Error('no guests field');
    await type(guests, '2');
    await click(button('Confirm and get PIN'));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(messageFor('proposal-gone'));
  });

  it('says when the booking was already handled', async () => {
    stubApi();
    await mount('/stays/proposed/gone', <ConfirmProposalPage />, '/stays/proposed/:id');
    expect(document.body.textContent).toContain('This booking was already handled.');
  });
});

describe('BookingLinksStep', () => {
  it('shows the domain and records the approval', async () => {
    stubApi();
    const done = vi.fn();
    await mount(
      '/x',
      <BookingLinksStep domain="guest.fetivi.test" propertyId="p1" onDone={done} />,
      '/x',
    );
    expect(document.body.textContent).toContain('guest.fetivi.test');
    await click(button('Done'));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', '/api/host/properties/p1/booking-links-approved'],
    ]);
    expect(done).toHaveBeenCalledOnce();
  });
});

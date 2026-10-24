// @vitest-environment happy-dom
import type { GuestProjection } from '@fetivi/domain/projection-types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { SpaceProvider } from '../space';
import { GuideSection } from './GuideSection';
import { GuideTab } from './GuideTab';

const RELEASE_AT = '2026-10-19T22:00:00.000Z';

function unit(
  released: boolean,
  blocks: GuestProjection['blocks'] = [],
  pending = !released,
): GuestProjection {
  return {
    language: 'en',
    property: {
      name: 'Villa Mare',
      addressLine: null,
      city: 'Trogir',
      postalCode: null,
      country: 'HR',
      timezone: 'Europe/Zagreb',
      location: null,
    },
    unit: { name: 'A1', maxOccupancy: 4, bedrooms: 1, beds: [], bathrooms: 1 },
    stay: {
      checkIn: '2026-10-21',
      checkout: '2026-10-24',
      partySize: 2,
      arrivalDetailsReleased: released,
      arrivalDetailsPending: pending,
      arrivalDetailsReleaseAt: RELEASE_AT,
    },
    checkInOut: { checkInTime: '15:00:00', checkoutTime: '10:00:00', checkInMethod: 'lockbox' },
    arrival: released
      ? {
          accessInstructions: 'Blue gate.',
          buildingDoorCode: null,
          doorCode: 'D-4412',
          lockboxCode: null,
        }
      : null,
    wifi: { network: 'Mare', password: released ? 'sea-breeze' : null },
    parking: { type: 'free_street', notes: null },
    houseRules: {
      petsAllowed: false,
      smokingAllowed: null,
      partiesAllowed: null,
      quietHoursFrom: null,
      quietHoursTo: null,
      notes: null,
    },
    contacts: {
      hostPhone: released ? '+385 91 000 1111' : null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    },
    amenities: [{ amenity: 'washer', note: null }],
    blocks,
  };
}

const HOW_TO: GuestProjection['blocks'][number] = {
  category: 'how_tos',
  title: 'Washer',
  body: [
    '- Load it',
    '- Program 3',
    '',
    '[Manual](https://example.com/manual)',
    '',
    '![x](http://evil.example/track.png)',
    '',
    '<script>window.hacked = true</script>',
    '',
    '# Big heading',
  ].join('\n'),
  media: [
    { id: 'm1', kind: 'image', caption: 'The dial' },
    { id: 'm2', kind: 'video', caption: 'Loading it' },
  ],
};

let root: Root | null = null;
let host: HTMLElement;
let urls: string[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Answers the Guide's reads and records every URL fetched. */
function stubApi(u: GuestProjection, places: unknown[] = [], picks: unknown[] = []) {
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url === '/api/unit') return json({ unit: u });
      if (url === '/api/guide/saved-places') return json({ places });
      if (url === '/api/guide/host-picks') return json({ places: picks });
      if (url === '/api/saved-places') return json({ placeIds: [] });
      return new Response(null, { status: 404 });
    }),
  );
}

async function mount(path: string) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <SpaceProvider
          initial={{
            status: 'ready',
            space: {
              language: 'en',
              closedAt: '2026-10-24T22:00:00Z',
              closed: false,
              unitSlug: 's',
              keepForEvaluation: false,
            },
          }}
        >
          <Routes>
            <Route path="/guide" element={<GuideTab />} />
            <Route path="/guide/:section" element={<GuideSection />} />
          </Routes>
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(() => expect(host.querySelector('p.status')).toBeNull());
}

const button = (name: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

describe('Guide index', () => {
  it('greets with the property name and lists the seven sections in order', async () => {
    stubApi(unit(false));
    await mount('/guide');
    expect(host.textContent).toContain('Welcome to Villa Mare!');
    const links = [...host.querySelectorAll('nav a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/guide/arrival',
      '/guide/wifi',
      '/guide/rules',
      '/guide/how-tos',
      '/guide/saved',
      '/guide/picks',
      '/guide/contacts',
    ]);
    expect(links[0]?.textContent).toContain('Arrival and access');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('offers a retry when the unit cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 502 })),
    );
    await mount('/guide');
    expect(host.textContent).toContain("I couldn't load your guide.");
    stubApi(unit(false));
    await act(async () => button('Try again').click());
    await vi.waitFor(() => expect(host.querySelectorAll('nav a')).toHaveLength(7));
  });
});

describe('Arrival and access', () => {
  it('says when the details appear, and shows no code before that', async () => {
    stubApi(unit(false));
    await mount('/guide/arrival');
    expect(host.querySelector('h1')?.textContent).toBe('Arrival and access');
    expect(host.querySelector('.fv-info-release')?.textContent).toMatch(
      /^These details appear on Tuesday, October 20/,
    );
    expect(host.textContent).toContain('Lockbox');
    expect(host.textContent).not.toContain('D-4412');
  });

  it('shows no release note when nothing is held back', async () => {
    stubApi(unit(false, [], false));
    await mount('/guide/arrival');
    expect(host.querySelector('h1')?.textContent).toBe('Arrival and access');
    expect(host.querySelector('.fv-info-release')).toBeNull();
    expect(host.textContent).toContain('Lockbox');
    act(() => root?.unmount());
    await mount('/guide/contacts');
    expect(host.querySelector('a[href="tel:112"]')).not.toBeNull();
    expect(host.querySelector('.fv-info-release')).toBeNull();
  });

  it('shows the codes after the release, and Copy writes the exact code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    stubApi(unit(true));
    await mount('/guide/arrival');
    expect(host.querySelector('.fv-info-release')).toBeNull();
    expect(host.querySelector('code')?.textContent).toBe('D-4412');
    await act(async () => button('Copy Door code').click());
    expect(writeText).toHaveBeenCalledWith('D-4412');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Copied');
  });
});

describe('Contacts and emergency', () => {
  it('always shows 112, and the host phone from the release', async () => {
    stubApi(unit(false));
    await mount('/guide/contacts');
    const before = [...host.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href'));
    expect(before).toEqual(['tel:112']);
    act(() => root?.unmount());
    stubApi(unit(true));
    await mount('/guide/contacts');
    const after = [...host.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href'));
    expect(after).toEqual(['tel:112', 'tel:+385910001111']);
  });
});

describe('Wi-Fi and essentials', () => {
  it('shows the network, the amenities and the parking', async () => {
    stubApi(unit(false));
    await mount('/guide/wifi');
    expect(host.textContent).toContain('Mare');
    expect(host.textContent).toContain('Washing machine');
    expect(host.textContent).toContain('Free street parking');
  });
});

describe('How-tos', () => {
  it('renders Markdown safely with the host photos and videos', async () => {
    stubApi(unit(true, [HOW_TO]));
    await mount('/guide/how-tos');
    const body = host.querySelector('.block-body');
    expect(body?.querySelectorAll('li')).toHaveLength(2);
    const link = body?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/manual');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
    // No image from the text, no raw HTML, and headings below the block title.
    expect(body?.querySelector('img')).toBeNull();
    expect(body?.querySelector('script')).toBeNull();
    expect(body?.innerHTML).not.toContain('hacked');
    expect(body?.querySelector('h3')?.textContent).toBe('Big heading');
    const media = host.querySelector('.fv-media');
    expect(media?.querySelector('img')?.getAttribute('alt')).toBe('The dial');
    expect(media?.querySelector('img')?.getAttribute('src')).toBe('/api/media/m1');
    expect(media?.querySelector('img + figcaption')?.textContent).toBe('The dial');
    expect(media?.querySelector('video + figcaption')?.textContent).toBe('Loading it');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('says when the host has added nothing', async () => {
    stubApi(unit(false));
    await mount('/guide/how-tos');
    expect(host.textContent).toContain("Your host hasn't added anything here yet.");
  });
});

describe('Saved places and top picks', () => {
  const place = {
    id: 'p1',
    kind: 'place',
    category: 'restaurant',
    title: 'Konoba Mala',
    summary: 'Grilled fish.',
    location: null,
    distanceKm: null,
    travelMinutes: null,
    image: null,
    verifiedAt: null,
    staleness: { status: 'fresh' },
  };

  it('shows the saved places as cards', async () => {
    stubApi(unit(false), [place]);
    await mount('/guide/saved');
    await vi.waitFor(() => expect(host.textContent).toContain('Konoba Mala'));
    expect(host.querySelector('.fv-carousel')).not.toBeNull();
  });

  it('explains how to save when nothing is saved', async () => {
    stubApi(unit(false), []);
    await mount('/guide/saved');
    await vi.waitFor(() =>
      expect(host.textContent).toContain('Places you save in the chat appear here.'),
    );
  });

  it("shows the empty state for the host's picks", async () => {
    stubApi(unit(false));
    await mount('/guide/picks');
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Your host's favourite places will appear here soon."),
    );
  });

  const TIPS: GuestProjection['blocks'][number] = {
    category: 'host_picks',
    title: 'Bread',
    body: 'The bakery opens at 6.',
    media: [],
  };

  it("shows the host's picks with the badge and note, then the tips", async () => {
    stubApi(
      unit(false, [TIPS]),
      [],
      [
        { ...place, hostPick: { note: 'Ask for the daily catch.' }, hostAdded: false },
        { ...place, id: 'h1', title: 'Cove', hostPick: { note: 'Quiet early.' }, hostAdded: true },
      ],
    );
    await mount('/guide/picks');
    await vi.waitFor(() => expect(host.textContent).toContain('Konoba Mala'));
    const cards = host.querySelectorAll('.fv-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector('.fv-badge')?.textContent).toBe("Your host's pick");
    expect(cards[0]?.querySelector('.fv-card-host-note')?.textContent).toBe(
      'Ask for the daily catch.',
    );
    expect(cards[0]?.querySelector('.fv-save')).not.toBeNull();
    expect(cards[1]?.querySelector('.fv-badge')?.textContent).toBe('Added by your host');
    expect(cards[1]?.querySelector('.fv-save')).toBeNull();
    const tips = host.querySelector('.guide-tips');
    expect(tips?.querySelector('h2')?.textContent).toBe('Neighbourhood tips');
    expect(tips?.textContent).toContain('The bakery opens at 6.');
    expect(host.querySelector('.fv-carousel')?.compareDocumentPosition(tips as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(host.textContent).not.toContain('appear here soon');
  });

  it('shows the tips alone when the host picked nothing', async () => {
    stubApi(unit(false, [TIPS]));
    await mount('/guide/picks');
    await vi.waitFor(() => expect(host.textContent).toContain('Neighbourhood tips'));
    expect(host.querySelector('.fv-carousel')).toBeNull();
    expect(host.textContent).not.toContain('appear here soon');
  });
});

describe('the Guide never calls the model', () => {
  it('reads only the unit, saved places and media on every section', async () => {
    const all: string[] = [];
    for (const slug of ['arrival', 'wifi', 'rules', 'how-tos', 'saved', 'picks', 'contacts']) {
      stubApi(unit(true, [HOW_TO]), []);
      await mount(`/guide/${slug}`);
      all.push(...urls);
      act(() => root?.unmount());
      root = null;
    }
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((u) => u.startsWith('/api/chat'))).toBe(false);
  });
});

describe('unknown section', () => {
  it('goes back to the index', async () => {
    stubApi(unit(false));
    await mount('/guide/nope');
    expect(host.querySelectorAll('nav a')).toHaveLength(7);
  });
});

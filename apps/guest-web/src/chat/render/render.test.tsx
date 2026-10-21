import type { UIMessage } from 'ai';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Space } from '../../api';
import { SpaceProvider } from '../../space';
import { ChatView } from '../ChatTab';

const space = (closed: boolean): Space => ({
  language: 'en',
  closedAt: '2026-10-26T23:00:00.000Z',
  closed,
  unitSlug: 'qrabc',
});

const render = (initial: UIMessage[], closed = false) =>
  renderToString(
    <MemoryRouter>
      <SpaceProvider initial={{ status: 'ready', space: space(closed) }}>
        <ChatView initial={initial} />
      </SpaceProvider>
    </MemoryRouter>,
  );

const card = (id: string, title: string) => ({
  id,
  kind: 'place',
  category: 'restaurant',
  title,
  summary: 'Grilled fish.',
  location: { lat: 43.517, lng: 16.251 },
  distanceKm: 0.4,
  travelMinutes: null,
  image: null,
  verifiedAt: null,
  staleness: { status: 'fresh' },
});

const carousel = (places: unknown[]) =>
  ({
    type: 'data-component',
    id: 'c1',
    data: { name: 'place-carousel', payload: { places } },
  }) as const;
const chips = {
  type: 'data-component',
  id: 'c2',
  data: { name: 'follow-up-chips', payload: { replies: ['Show me on a map'] } },
} as const;

const question: UIMessage = {
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text: 'Where should we eat tonight?' }],
};
const answer = (parts: unknown[]): UIMessage => ({
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Try Konoba Mala.' }, ...parts] as UIMessage['parts'],
});
const later: UIMessage[] = [
  { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Thanks' }] },
  { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'Enjoy!' }] },
];

describe('component parts in the chat', () => {
  it('renders the bubble, the carousel and the chips of the newest answer', () => {
    const html = render([
      question,
      answer([carousel([card('p1', 'Konoba Mala'), card('p2', 'Konoba Velika')]), chips]),
    ]);
    expect(html).toContain('Try Konoba Mala.');
    expect(html).toContain('class="fv-carousel"');
    expect(html.indexOf('Konoba Mala</h3>')).toBeLessThan(html.indexOf('Konoba Velika</h3>'));
    expect(html).toContain('aria-label="Suggested replies"');
    expect(html).toContain('>Show me on a map</button>');
    expect(html).toContain('>Save</button>');
  });

  it('puts the words before cards the model showed first', () => {
    const html = render([
      question,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          carousel([card('p1', 'Konoba Mala')]),
          { type: 'text', text: 'Konoba Mala is my pick.' },
          { type: 'text', text: 'Book ahead.' },
        ] as UIMessage['parts'],
      },
    ]);
    expect(html.indexOf('Konoba Mala is my pick.')).toBeLessThan(
      html.indexOf('class="fv-carousel"'),
    );
    expect(html.match(/class="bubble fetivi"/g)).toHaveLength(1);
  });

  it('puts chips after text written after them', () => {
    const html = render([
      question,
      {
        id: 'a1',
        role: 'assistant',
        parts: [chips, { type: 'text', text: 'Try Konoba Mala.' }] as UIMessage['parts'],
      },
    ]);
    expect(html.indexOf('Try Konoba Mala.')).toBeLessThan(html.indexOf('Suggested replies'));
  });

  it('hides chips on an older answer', () => {
    const html = render([
      question,
      answer([carousel([card('p1', 'Konoba Mala')]), chips]),
      ...later,
    ]);
    expect(html).toContain('class="fv-carousel"');
    expect(html).not.toContain('Suggested replies');
  });

  it('skips an invalid or unknown payload and keeps the text', () => {
    const html = render([
      question,
      answer([
        carousel([]),
        { type: 'data-component', id: 'c3', data: { name: 'weather', payload: {} } },
      ]),
    ]);
    expect(html).toContain('Try Konoba Mala.');
    expect(html).not.toContain('fv-carousel');
  });

  it('after the Stay shows no chips and no Save on unsaved places', () => {
    const html = render([question, answer([carousel([card('p1', 'Konoba Mala')]), chips])], true);
    expect(html).toContain('class="fv-carousel"');
    expect(html).not.toContain('Suggested replies');
    expect(html).not.toContain('fv-save');
  });
});

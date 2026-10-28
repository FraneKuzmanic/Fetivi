import type { ChatStatus, UIMessage } from 'ai';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Space } from '../api';
import '../i18n';
import { SpaceProvider } from '../space';
import { MessageList } from './MessageList';

const space: Space = {
  language: 'en',
  closedAt: '2026-10-26T23:00:00.000Z',
  closed: false,
  unitSlug: 'qrabc',
  keepForEvaluation: false,
};

const render = (messages: UIMessage[], status: ChatStatus = 'ready') =>
  renderToString(
    <MemoryRouter>
      <SpaceProvider initial={{ status: 'ready', space }}>
        <MessageList
          messages={messages}
          status={status}
          interactive={status === 'ready'}
          onSend={() => {}}
          onSomethingElse={() => {}}
          onAnswer={() => {}}
        />
      </SpaceProvider>
    </MemoryRouter>,
  );

const place = (id: string, title: string) => ({
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
const carousel = (id: string, title: string) => ({
  type: 'data-component',
  id,
  data: { name: 'place-carousel', payload: { places: [place(`p-${id}`, title)] } },
});
const chips = {
  type: 'data-component',
  id: 'chips',
  data: { name: 'follow-up-chips', payload: { replies: ['Show me on a map'] } },
};
const text = (value: string, state?: 'streaming' | 'done') => ({
  type: 'text',
  text: value,
  state,
});
const search = {
  type: 'tool-web_fallback_search',
  toolCallId: 'call-web',
  state: 'output-available',
  input: { query: 'museum' },
  output: {},
};
const webResults = {
  type: 'data-component',
  id: 'web',
  data: {
    name: 'web-results',
    payload: {
      results: [
        {
          title: 'Town museum hours',
          snippet: 'Open every day 10–13.',
          url: 'https://www.visittrogir.hr/en/museum',
          source: { host: 'visittrogir.hr', kind: 'tourist_board' },
        },
      ],
    },
  },
};

const question: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] };
const answer = (parts: unknown[]): UIMessage[] => [
  question,
  { id: 'a1', role: 'assistant', parts: parts as UIMessage['parts'] },
];

const bubbles = (html: string) => html.match(/class="bubble fetivi"/g)?.length ?? 0;

describe('MessageList part order', () => {
  it('keeps a card shown first above the text written after it', () => {
    const html = render(answer([carousel('c1', 'Konoba Mala'), text('Konoba Mala is my pick.')]));
    expect(html.indexOf('class="fv-carousel"')).toBeLessThan(
      html.indexOf('Konoba Mala is my pick.'),
    );
  });

  it('renders text, card, text in that order, in two bubbles', () => {
    const html = render(
      answer([
        text('Here is one.'),
        { type: 'step-start' },
        carousel('c1', 'Konoba Mala'),
        { type: 'step-start' },
        text('Book ahead.'),
      ]),
    );
    const first = html.indexOf('Here is one.');
    const card = html.indexOf('class="fv-carousel"');
    const second = html.indexOf('Book ahead.');
    expect(first).toBeLessThan(card);
    expect(card).toBeLessThan(second);
    expect(bubbles(html)).toBe(2);
  });

  it('joins text around a call with nothing to show into one bubble', () => {
    const html = render(
      answer([
        text('Let me look.'),
        { type: 'step-start' },
        {
          type: 'tool-list_offers',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {},
          output: {},
        },
        { type: 'step-start' },
        text('Found two.'),
      ]),
    );
    expect(bubbles(html)).toBe(1);
    expect(html).toContain('Let me look.\nFound two.');
  });

  it('puts follow-up chips last, even when they came before the text', () => {
    const html = render(answer([chips, text('Enjoy!')]));
    expect(html.indexOf('Enjoy!')).toBeLessThan(html.indexOf('aria-label="Suggested replies"'));
  });

  it('shows an open confirmation card where it streamed, on the newest answer', () => {
    const html = render(
      answer([
        text('I can tell your host.'),
        {
          type: 'tool-send_host_message',
          toolCallId: 'call-send',
          state: 'input-available',
          input: { message: 'No hot water.' },
        },
        {
          type: 'data-elicitation',
          id: 'call-send',
          data: {
            toolCallId: 'call-send',
            toolName: 'send_host_message',
            key: 'confirm',
            message: 'Send this message to your host?',
            requestedSchema: {
              type: 'object',
              properties: {
                message: { type: 'string', maxLength: 1000, default: 'No hot water.' },
              },
              required: ['message'],
            },
            requestState: 'sealed.state',
            draft: null,
            hostMessage: {
              pendingId: 'p-1',
              messageId: 'm-1',
              text: 'No hot water.',
              reason: 'problem',
              urgency: 'urgent',
              language: 'en',
            },
          },
        },
        text('Tap Send when it looks right.'),
      ]),
    );
    const card = html.indexOf('No hot water.');
    expect(html.indexOf('I can tell your host.')).toBeLessThan(card);
    expect(card).toBeLessThan(html.indexOf('Tap Send when it looks right.'));
  });

  it('names only the first bubble of an answer for screen readers', () => {
    const html = render(answer([text('One.'), carousel('c1', 'Konoba Mala'), text('Two.')]));
    expect(html.match(/Fetivi: <\/span>/g)).toHaveLength(1);
    expect(html.indexOf('Fetivi: </span>')).toBeLessThan(html.indexOf('One.'));
  });
});

describe('MessageList typing line', () => {
  it('hides while text streams in', () => {
    const html = render(answer([text('Look', 'streaming')]), 'streaming');
    expect(html).not.toContain('class="typing"');
  });

  it('shows while Fetivi works after its first words', () => {
    const html = render(
      answer([
        text('Let me look.', 'done'),
        { type: 'step-start' },
        { type: 'tool-list_offers', toolCallId: 'c', state: 'input-available', input: {} },
      ]),
      'streaming',
    );
    expect(html).toContain('class="typing"');
  });
});

describe('MessageList web citations', () => {
  it('turns a [1] after a search into a badge, with no source row', () => {
    const html = render(answer([search, webResults, text('It opens at 10 [1]. Enjoy.')]));
    expect(html).toContain('class="fv-cite"');
    expect(html).toContain('aria-label="Source: visittrogir.hr"');
    expect(html).toContain('>visittrogir</button>');
    expect(html).not.toContain('[1]');
    expect(html).not.toContain('fv-source-row');
  });

  it('shows one row of sources when the finished answer cited none', () => {
    const html = render(answer([search, webResults, text('It opens at 10.')]));
    expect(html).toContain('class="fv-source-row"');
    expect(html).not.toContain('fv-cite');
    expect(html.indexOf('It opens at 10.')).toBeLessThan(html.indexOf('fv-source-row'));
  });

  it('shows no source row while the answer still streams', () => {
    const html = render(answer([search, webResults, text('It opens', 'streaming')]), 'streaming');
    expect(html).not.toContain('fv-source-row');
  });

  it('leaves brackets alone in answers without web results', () => {
    const html = render(answer([text('Pick option [1] or [2].')]));
    expect(html).toContain('Pick option [1] or [2].');
    expect(html).not.toContain('fv-cite');
  });
});

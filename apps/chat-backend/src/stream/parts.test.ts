import { weatherToolResult } from '@fetivi/domain';
import { sampleWeatherReport } from '@fetivi/domain/testing';
import type { UIMessageChunk } from 'ai';
import { describe, expect, it } from 'vitest';
import { componentFor, withComponentParts } from './parts';

const result = (id: string, title: string) => ({
  id,
  kind: 'place',
  category: 'restaurant',
  title,
  summary: 'Fish by the sea.',
  location: { lat: 43.5, lng: 16.2 },
  distanceKm: 0.3,
  travelMinutes: null,
  address: 'Obala 1',
  phone: '+385 21 000',
  websiteUrl: null,
  image: {
    url: 'https://img.test/a.jpg',
    source: 'own_photo',
    licence: null,
    attribution: 'Ana',
    sourcePageUrl: null,
  },
  verifiedAt: null,
  staleness: { status: 'never_verified', staleAt: null },
  sources: [{ field: 'phone', url: 'https://src.test' }],
  open: 'open',
});

describe('componentFor', () => {
  it('turns search results into a carousel, in order, with only the card fields', () => {
    const part = componentFor('search_places', {
      date: '2027-07-12',
      openAt: null,
      results: [result('1', 'Konoba A'), result('2', 'Konoba B')],
    });
    expect(part?.name).toBe('place-carousel');
    if (part?.name !== 'place-carousel') return;
    expect(part.payload.places.map((p) => p.title)).toEqual(['Konoba A', 'Konoba B']);
    const card = part.payload.places[0] as Record<string, unknown>;
    expect(card.phone).toBeUndefined();
    expect(card.sources).toBeUndefined();
    expect(card.staleness).toEqual({ status: 'never_verified' });
    expect(card.image).toEqual({
      url: 'https://img.test/a.jpg',
      licence: null,
      attribution: 'Ana',
      sourcePageUrl: null,
    });
  });

  it('shows nothing for an empty, invalid or unknown result', () => {
    expect(componentFor('search_places', { results: [] })).toBeNull();
    expect(componentFor('search_places', 'text only')).toBeNull();
    const { title: _t, ...untitled } = result('1', 'x');
    expect(componentFor('search_places', { results: [untitled] })).toBeNull();
    expect(componentFor('get_place', { place: result('1', 'x') })).toBeNull();
  });

  it('maps the presentation tools from their input', () => {
    expect(componentFor('suggest_replies', { replies: ['More'] })).toEqual({
      name: 'follow-up-chips',
      payload: { replies: ['More'] },
    });
    expect(componentFor('ask_choice', { question: 'Which?', options: ['a', 'b'] })).toEqual({
      name: 'choice-card',
      payload: { question: 'Which?', options: ['a', 'b'], multiple: false },
    });
    expect(componentFor('suggest_replies', { replies: [] })).toBeNull();
  });
});

async function run(
  chunks: UIMessageChunk[],
  appPart?: (toolCallId: string) => unknown,
): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  }).pipeThrough(withComponentParts(appPart));
  for await (const c of stream) out.push(c);
  return out;
}

describe('withComponentParts', () => {
  it('adds the component right after its tool output', async () => {
    const out = await run([
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 's', toolName: 'search_places', input: {} },
      {
        type: 'tool-output-available',
        toolCallId: 's',
        output: { results: [result('1', 'Konoba A')] },
      },
      {
        type: 'tool-input-available',
        toolCallId: 'r',
        toolName: 'suggest_replies',
        input: { replies: ['Cheaper?'] },
      },
      { type: 'tool-output-available', toolCallId: 'r', output: { shown: true } },
      { type: 'finish' },
    ]);
    expect(out.map((c) => c.type)).toEqual([
      'start',
      'tool-input-available',
      'tool-output-available',
      'data-component',
      'tool-input-available',
      'tool-output-available',
      'data-component',
      'finish',
    ]);
    expect(out[3]).toMatchObject({ id: 's', data: { name: 'place-carousel' } });
    expect(out[6]).toMatchObject({
      id: 'r',
      data: { name: 'follow-up-chips', payload: { replies: ['Cheaper?'] } },
    });
  });

  it('leaves streams without components unchanged', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Hi' },
      { type: 'text-end', id: 't' },
      { type: 'tool-input-available', toolCallId: 'x', toolName: 'search_places', input: {} },
      { type: 'tool-output-error', toolCallId: 'x', errorText: 'boom' },
      { type: 'tool-input-available', toolCallId: 'y', toolName: 'get_place', input: {} },
      { type: 'tool-output-available', toolCallId: 'y', output: { place: {} } },
      { type: 'finish' },
    ];
    expect(await run(chunks)).toEqual(chunks);
  });
});

const ORDER = {
  id: 'f2b1c3d4-0000-4000-8000-000000000001',
  offerId: 'o-1',
  offerTitle: 'Blue Lagoon boat trip',
  status: 'confirmed',
  paymentStatus: 'none',
  paymentMode: 'direct',
  date: '2026-10-22',
  startsAt: '2026-10-22T07:00:00.000Z',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  createdAt: '2026-10-21T10:00:00.000Z',
  payBy: null,
};

describe('booking components', () => {
  const day = { offerId: 'o-1', date: '2026-10-22', quantity: 2 };

  it('shows the starts of a day as a picker, without the instants', () => {
    const part = componentFor('check_availability', {
      ...day,
      starts: [
        {
          slotId: 's-1',
          startsAt: '2026-10-22T07:00:00.000Z',
          startsAtLocal: '2026-10-22T09:00',
          remaining: 8,
        },
      ],
    });
    expect(part).toEqual({
      name: 'availability-picker',
      payload: {
        ...day,
        starts: [{ slotId: 's-1', startsAtLocal: '2026-10-22T09:00', remaining: 8 }],
      },
    });
  });

  it('shows nothing for a day without starts', () => {
    expect(componentFor('check_availability', { ...day, starts: [] })).toBeNull();
  });

  it('shows a receipt only for an Order that was made', () => {
    expect(componentFor('create_order', { outcome: 'ordered', order: ORDER })).toEqual({
      name: 'receipt-card',
      payload: { order: ORDER },
    });
    expect(componentFor('create_order', { outcome: 'not_ordered', order: null })).toBeNull();
  });
});

describe('host message components', () => {
  const message = {
    id: 'm-1',
    text: 'No hot water',
    urgency: 'urgent',
    sentAt: '2027-05-01T10:00:00.000Z',
  };

  it('shows the sent card only for a sent message', () => {
    expect(componentFor('send_host_message', { outcome: 'sent', message })).toEqual({
      name: 'host-message-sent',
      payload: { message },
    });
    expect(componentFor('send_host_message', { outcome: 'not_sent', message: null })).toBeNull();
  });

  it('shows 112 first, then the host phone, for an emergency; nothing for a draft', () => {
    const emergency = {
      emergencyNumber: '112',
      hostPhone: '+385 91 111',
      emergencyContactName: 'Ana',
      emergencyContactPhone: null,
      releaseAt: null,
      timezone: 'Europe/Zagreb',
    };
    expect(
      componentFor('draft_host_message', { outcome: 'emergency', draft: null, emergency }),
    ).toEqual({
      name: 'property-info',
      payload: {
        topic: 'contacts',
        releaseAt: null,
        timezone: 'Europe/Zagreb',
        fields: [
          { key: 'emergencyNumber', value: '112', action: 'tel' },
          { key: 'hostPhone', value: '+385 91 111', action: 'tel' },
          { key: 'emergencyContactName', value: 'Ana', action: 'text' },
        ],
        media: [],
      },
    });
    expect(
      componentFor('draft_host_message', {
        outcome: 'draft',
        draft: { message: 'x', reason: 'problem', urgency: 'normal' },
        emergency: null,
      }),
    ).toBeNull();
  });
});

describe('day plan component', () => {
  const plan = {
    checkIn: '2027-07-14',
    checkout: '2027-07-16',
    today: '2027-07-15',
    days: [
      {
        date: '2027-07-15',
        items: [
          {
            id: 'i1',
            kind: 'suggestion',
            date: '2027-07-15',
            time: '09:00',
            title: 'Swim at Pantan',
            note: null,
            placeId: null,
            offerId: null,
            orderId: null,
            orderStatus: null,
          },
        ],
      },
    ],
  };

  it('shows the plan of get_plan and update_plan as a day plan', () => {
    expect(componentFor('get_plan', { plan })).toEqual({ name: 'day-plan', payload: plan });
    expect(componentFor('update_plan', { plan })).toEqual({ name: 'day-plan', payload: plan });
  });

  it('shows nothing for an error text or a malformed plan', () => {
    expect(componentFor('update_plan', "That date is outside the guest's stay.")).toBeNull();
    expect(componentFor('get_plan', { plan: { ...plan, days: [] } })).toBeNull();
    expect(componentFor('get_plan', { plan: null })).toBeNull();
  });
});

describe('weather component', () => {
  const place = { lat: 43.52, lng: 16.25, timezone: 'Europe/Zagreb' };
  const value = weatherToolResult(
    sampleWeatherReport('2027-07-15'),
    place,
    '2027-07-15',
    new Date('2027-07-15T08:00:00Z'),
  );

  it('shows a get_weather result as the weather card, without the fields it does not show', () => {
    const part = componentFor('get_weather', value);
    expect(part?.name).toBe('weather');
    expect(part?.payload).not.toHaveProperty('forecastUpdatedAt');
    expect(part?.name === 'weather' && part.payload.days?.[0]).not.toHaveProperty('symbolCode');
  });

  it('shows nothing for an error text', () => {
    expect(
      componentFor('get_weather', 'The weather services are not answering right now.'),
    ).toBeNull();
  });
});

describe('web results component', () => {
  const result = {
    title: 'Kayaking in Trogir',
    snippet: 'Sea kayak tours.',
    url: 'https://www.visittrogir.hr/en/kayak',
    source: { host: 'visittrogir.hr', kind: 'tourist_board' },
  };

  it('shows web_fallback_search results as links with source chips', () => {
    expect(componentFor('web_fallback_search', { results: [result] })).toEqual({
      name: 'web-results',
      payload: { results: [result] },
    });
  });

  it('shows nothing for no results, an error text or a javascript link', () => {
    expect(componentFor('web_fallback_search', { results: [] })).toBeNull();
    expect(
      componentFor('web_fallback_search', 'Web search is not available right now.'),
    ).toBeNull();
    expect(
      componentFor('web_fallback_search', { results: [{ ...result, url: 'javascript:alert(1)' }] }),
    ).toBeNull();
  });
});

describe('MCP App parts', () => {
  const app = {
    server: 'ferryhopper',
    toolName: 'search_ferry_trips',
    resourceUri: 'ui://widgets/ferry-trips-picker.html',
    pinHash: 'abc',
    input: { legs: [] },
    result: { content: [{ type: 'text', text: 'trips' }], structuredContent: { legs: [] } },
  };
  const ferryCall: UIMessageChunk[] = [
    { type: 'tool-input-available', toolCallId: 'f', toolName: 'search_ferry_trips', input: {} },
    { type: 'tool-output-available', toolCallId: 'f', output: { legs: [] } },
  ];

  it('adds the widget part right after a Ferryhopper output', async () => {
    const out = await run(ferryCall, (id) => (id === 'f' ? app : undefined));
    expect(out.map((c) => c.type)).toEqual([
      'tool-input-available',
      'tool-output-available',
      'data-mcp-app',
    ]);
    expect(out[2]).toMatchObject({ id: 'f', data: app });
  });

  it('adds none for a plain tool', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'tool-input-available', toolCallId: 'y', toolName: 'get_place', input: {} },
      { type: 'tool-output-available', toolCallId: 'y', output: { place: {} } },
    ];
    expect(await run(chunks, () => undefined)).toEqual(chunks);
  });

  it('skips an invalid part or a throwing lookup without breaking the stream', async () => {
    expect(await run(ferryCall, () => ({ ...app, resourceUri: 'https://x' }))).toEqual(ferryCall);
    expect(
      await run(ferryCall, () => {
        throw new Error('boom');
      }),
    ).toEqual(ferryCall);
  });
});

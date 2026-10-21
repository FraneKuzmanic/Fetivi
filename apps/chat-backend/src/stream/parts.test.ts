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

async function run(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  }).pipeThrough(withComponentParts());
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

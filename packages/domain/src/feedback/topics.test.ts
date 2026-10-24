import { describe, expect, it } from 'vitest';
import { PLACE_CATEGORIES } from '../catalog/vocabulary';
import type { MessagePart } from '../db/schema/conversations';
import { answerPlaceIds, answerTopics } from './topics';
import { ANSWER_TOPICS } from './vocabulary';

const tool = (name: string, extra: Record<string, unknown> = {}): MessagePart => ({
  type: `tool-${name}`,
  toolCallId: `call-${name}`,
  state: 'output-available',
  input: {},
  output: {},
  ...extra,
});
const text: MessagePart = { type: 'text', text: 'Here you go' };

describe('answerTopics', () => {
  it('is general when no topical tool ran', () => {
    expect(answerTopics([text])).toEqual(['general']);
    expect(answerTopics([text, tool('suggest_replies'), tool('ask_choice')])).toEqual(['general']);
    expect(answerTopics([tool('unknown_tool')])).toEqual(['general']);
  });

  it('takes show_property_info topic from its input', () => {
    for (const topic of ['arrival', 'wifi', 'checkout', 'contacts']) {
      expect(answerTopics([tool('show_property_info', { input: { topic } })])).toEqual([topic]);
    }
    expect(answerTopics([tool('show_property_info', { input: { topic: 'pool' } })])).toEqual([
      'general',
    ]);
  });

  it('takes search_places category, falling back to places', () => {
    expect(answerTopics([tool('search_places', { input: { category: 'beach' } })])).toEqual([
      'beach',
    ]);
    expect(answerTopics([tool('search_places', { input: { category: 'day_trip' } })])).toEqual([
      'day_trip',
    ]);
    expect(answerTopics([tool('search_places', { input: { category: 'zoo' } })])).toEqual([
      'places',
    ]);
    expect(answerTopics([tool('search_places', { input: { query: 'fortress' } })])).toEqual([
      'places',
    ]);
  });

  it('takes get_place category from its output', () => {
    expect(
      answerTopics([tool('get_place', { output: { place: { category: 'restaurant' } } })]),
    ).toEqual(['restaurant']);
    expect(answerTopics([tool('get_place', { output: { place: { category: 'x' } } })])).toEqual([
      'places',
    ]);
    expect(answerTopics([tool('get_place', { output: null })])).toEqual(['places']);
  });

  it.each([
    ['list_host_picks', 'host_picks'],
    ['search_events', 'events'],
    ['get_weather', 'weather'],
    ['get_transport_notes', 'transport'],
    ['search_ferry_trips', 'transport'],
    ['trip_details', 'transport'],
    ['get_ports', 'transport'],
    ['get_direct_connections_for_ports', 'transport'],
    ['get_disruptions', 'transport'],
    ['web_fallback_search', 'web_search'],
    ['list_offers', 'services'],
    ['check_availability', 'services'],
    ['create_order', 'services'],
    ['list_my_orders', 'orders'],
    ['cancel_order', 'orders'],
    ['respond_to_order_update', 'orders'],
    ['draft_host_message', 'host_message'],
    ['send_host_message', 'host_message'],
    ['get_plan', 'plan'],
    ['update_plan', 'plan'],
    ['get_about_me', 'about_me'],
    ['update_about_me', 'about_me'],
  ])('maps %s to %s', (name, topic) => {
    expect(answerTopics([tool(name)])).toEqual([topic]);
  });

  it('is distinct, in first-seen order', () => {
    expect(
      answerTopics([
        tool('get_weather'),
        text,
        tool('search_places', { input: { category: 'beach' } }),
        tool('get_weather'),
        tool('search_places', { input: { category: 'beach' } }),
        tool('show_property_info', { input: { topic: 'wifi' } }),
      ]),
    ).toEqual(['weather', 'beach', 'wifi']);
  });

  it('gives every place category its own topic, not the places fallback', () => {
    for (const c of PLACE_CATEGORIES) {
      expect(answerTopics([tool('search_places', { input: { category: c } })])).toEqual([c]);
    }
  });

  it('covers every place category and day trips', () => {
    for (const c of [...PLACE_CATEGORIES, 'day_trip']) {
      expect(ANSWER_TOPICS).toContain(c);
    }
  });
});

describe('answerPlaceIds', () => {
  it('reads search_places, list_host_picks and get_place outputs', () => {
    expect(
      answerPlaceIds([
        tool('search_places', { output: { results: [{ id: 'a' }, { id: 'b' }] } }),
        tool('list_host_picks', { output: { results: [{ id: 'c' }] } }),
        tool('get_place', { output: { place: { id: 'd' } } }),
      ]),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('skips host-added places, errored calls, duplicates and malformed outputs', () => {
    expect(
      answerPlaceIds([
        tool('search_places', {
          output: { results: [{ id: 'a' }, { id: 'h', hostAdded: true }, { id: 7 }, null] },
        }),
        tool('search_places', { output: { results: [{ id: 'a', hostAdded: false }] } }),
        tool('search_places', { state: 'output-error', errorText: 'boom', output: undefined }),
        tool('get_place', { state: 'input-available', output: { place: { id: 'x' } } }),
        tool('list_host_picks', { output: { results: 'nope' } }),
        tool('get_place', { output: { place: 'nope' } }),
        tool('search_events', { output: { results: [{ id: 'e' }] } }),
        text,
      ]),
    ).toEqual(['a']);
  });
});

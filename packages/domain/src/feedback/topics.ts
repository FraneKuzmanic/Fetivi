import { PLACE_CATEGORIES } from '../catalog/vocabulary';
import type { MessagePart } from '../db/schema/conversations';
import type { AnswerTopic } from './vocabulary';

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

const PROPERTY_INFO_TOPICS = ['arrival', 'wifi', 'checkout', 'contacts'] as const;
/** Built from PLACE_CATEGORIES, so a new category gets its own topic or fails to typecheck. */
const PLACE_TOPICS = [...PLACE_CATEGORIES, 'day_trip'] as const satisfies readonly AnswerTopic[];

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

/** Tools whose topic does not depend on their input or output. */
const FIXED: Record<string, AnswerTopic> = {
  list_host_picks: 'host_picks',
  search_events: 'events',
  get_weather: 'weather',
  get_transport_notes: 'transport',
  // The pinned Ferryhopper tools (apps/chat-backend/src/mcp/external/pin.ts).
  search_ferry_trips: 'transport',
  trip_details: 'transport',
  get_ports: 'transport',
  get_direct_connections_for_ports: 'transport',
  get_disruptions: 'transport',
  web_fallback_search: 'web_search',
  list_offers: 'services',
  check_availability: 'services',
  create_order: 'services',
  list_my_orders: 'orders',
  cancel_order: 'orders',
  respond_to_order_update: 'orders',
  draft_host_message: 'host_message',
  send_host_message: 'host_message',
  get_plan: 'plan',
  update_plan: 'plan',
  get_about_me: 'about_me',
  update_about_me: 'about_me',
};

const toolName = (part: MessagePart): string | null =>
  part.type.startsWith('tool-') ? part.type.slice(5) : null;

function topicOf(part: MessagePart): AnswerTopic | null {
  const name = toolName(part);
  if (name === null) return null;
  switch (name) {
    case 'show_property_info':
      return oneOf(PROPERTY_INFO_TOPICS, isRecord(part.input) ? part.input.topic : null);
    case 'search_places':
      return oneOf(PLACE_TOPICS, isRecord(part.input) ? part.input.category : null) ?? 'places';
    case 'get_place': {
      const place = isRecord(part.output) ? part.output.place : null;
      return oneOf(PLACE_TOPICS, isRecord(place) ? place.category : null) ?? 'places';
    }
    default:
      // suggest_replies, ask_choice and unknown tools carry no topic.
      return FIXED[name] ?? null;
  }
}

/**
 * What an answer was about, from the tools it used (43 AC 1, AC 3): distinct, in first-seen
 * order, `general` when no topical tool ran. Never reads text.
 */
export function answerTopics(parts: MessagePart[]): AnswerTopic[] {
  const seen = new Set<AnswerTopic>();
  for (const part of parts) {
    const topic = topicOf(part);
    if (topic !== null) seen.add(topic);
  }
  return seen.size ? [...seen] : ['general'];
}

/**
 * The catalog place ids an answer showed (43 AC 2): from successful search_places,
 * list_host_picks and get_place outputs, distinct, host-added places skipped. Parts are untyped
 * jsonb, so everything is read defensively.
 */
export function answerPlaceIds(parts: MessagePart[]): string[] {
  const ids = new Set<string>();
  const add = (entry: unknown) => {
    if (isRecord(entry) && entry.hostAdded !== true && typeof entry.id === 'string')
      ids.add(entry.id);
  };
  for (const part of parts) {
    if (part.state !== 'output-available' || !isRecord(part.output)) continue;
    const name = toolName(part);
    if (name === 'search_places' || name === 'list_host_picks') {
      const results = part.output.results;
      if (Array.isArray(results)) results.forEach(add);
    } else if (name === 'get_place') {
      add(part.output.place);
    }
  }
  return [...ids];
}

import { type ComponentPart, componentPart } from '@fetivi/ui/payloads';

/** At most this many cards per show_results call (ticket 65). */
export const SHOW_RESULTS_MAX = 5;

export type ResultKind = 'places' | 'events';

/**
 * The places and events this turn's searches returned, so show_results can draw cards for the
 * ones the answer recommends (ticket 65). One per HTTP turn: ids from earlier turns are unknown.
 */
export interface TurnResults {
  /** Keeps the places/events of a search output; any other tool or shape is ignored. */
  record(toolName: string, output: unknown): void;
  /** Keeps the component for these ids in this order and returns its size; throws an Error the model reads otherwise. */
  show(toolCallId: string, kind: ResultKind, ids: string[]): number;
  /** The component a show_results call chose, for the stream. */
  shown(toolCallId: string): ComponentPart | undefined;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

const SOURCES: Record<string, ResultKind> = {
  search_places: 'places',
  list_host_picks: 'places',
  search_events: 'events',
};

export function turnResults(): TurnResults {
  const found: Record<ResultKind, Map<string, unknown>> = { places: new Map(), events: new Map() };
  const parts = new Map<string, ComponentPart>();
  return {
    record(toolName, output) {
      const kind = SOURCES[toolName];
      const results = isRecord(output) ? output.results : null;
      if (!kind || !Array.isArray(results)) return;
      for (const r of results) {
        // The same id is the same entity; a later output just refreshes it.
        if (isRecord(r) && typeof r.id === 'string') found[kind].set(r.id, r);
      }
    },
    show(toolCallId, kind, ids) {
      const unknown = ids.filter((id) => !found[kind].has(id));
      if (unknown.length > 0) {
        const from = kind === 'places' ? 'search_places or list_host_picks' : 'search_events';
        throw new Error(
          `Unknown ${kind} ids: ${unknown.join(', ')}. Use only ids that ${from} returned in this turn.`,
        );
      }
      const items = ids.map((id) => found[kind].get(id));
      // Parsing keeps only the fields a card shows; contact details and sources stay in the result.
      const parsed = componentPart.safeParse(
        kind === 'places'
          ? { name: 'place-carousel', payload: { places: items } }
          : { name: 'event-list', payload: { events: items } },
      );
      if (!parsed.success) throw new Error('These results cannot be shown as cards.');
      parts.set(toolCallId, parsed.data);
      return ids.length;
    },
    shown: (toolCallId) => parts.get(toolCallId),
  };
}

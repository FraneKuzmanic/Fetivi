import { COMPONENT_PART_TYPE, type ComponentPart, componentPart } from '@fetivi/ui/payloads';
import type { UIMessageChunk } from 'ai';
import { isPresentationTool } from './presentation';

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

/** Only the fields a card shows; contact details and sources stay in the tool result. */
const cardOf = (r: Rec) => {
  const image = isRecord(r.image) ? r.image : null;
  const staleness = isRecord(r.staleness) ? r.staleness : null;
  return {
    id: r.id,
    kind: r.kind,
    category: r.category,
    title: r.title,
    summary: r.summary,
    location: r.location,
    distanceKm: r.distanceKm,
    travelMinutes: r.travelMinutes,
    image: image && {
      url: image.url,
      attribution: image.attribution,
      licence: image.licence,
      sourcePageUrl: image.sourcePageUrl,
    },
    verifiedAt: r.verifiedAt,
    staleness: staleness && { status: staleness.status },
  };
};

const candidate = (toolName: string, value: unknown): unknown => {
  switch (toolName) {
    case 'search_places': {
      const results = isRecord(value) ? value.results : null;
      if (!Array.isArray(results) || results.length === 0) return null;
      return {
        name: 'place-carousel',
        payload: { places: results.map((r) => (isRecord(r) ? cardOf(r) : r)) },
      };
    }
    case 'suggest_replies':
      return { name: 'follow-up-chips', payload: value };
    case 'ask_choice':
      return { name: 'choice-card', payload: value };
    default:
      return null;
  }
};

/**
 * The component a tool result shows, validated; null for any other tool, an empty search or an
 * invalid payload (the answer's text still carries it). Presentation tools pass their input.
 */
export function componentFor(toolName: string, value: unknown): ComponentPart | null {
  const part = candidate(toolName, value);
  if (part === null) return null;
  const parsed = componentPart.safeParse(part);
  return parsed.success ? parsed.data : null;
}

/**
 * Adds a `data-component` chunk right after each tool output that maps to a valid component. Never
 * throws: a payload that cannot be shown is skipped and the stream goes on.
 */
export function withComponentParts(): TransformStream<UIMessageChunk, UIMessageChunk> {
  const calls = new Map<string, { toolName: string; input: unknown }>();
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (chunk.type === 'tool-input-available') {
        calls.set(chunk.toolCallId, { toolName: chunk.toolName, input: chunk.input });
        return;
      }
      if (chunk.type !== 'tool-output-available' || chunk.preliminary) return;
      const call = calls.get(chunk.toolCallId);
      if (!call) return;
      let data: ComponentPart | null = null;
      try {
        data = componentFor(
          call.toolName,
          isPresentationTool(call.toolName) ? call.input : chunk.output,
        );
      } catch {
        data = null;
      }
      if (data) controller.enqueue({ type: COMPONENT_PART_TYPE, id: chunk.toolCallId, data });
    },
  });
}

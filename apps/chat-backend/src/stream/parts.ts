import { COMPONENT_PART_TYPE, type ComponentPart, componentPart } from '@fetivi/ui/payloads';
import type { UIMessageChunk } from 'ai';
import { isPresentationTool } from './presentation';

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

const candidate = (toolName: string, value: unknown): unknown => {
  switch (toolName) {
    case 'search_places': {
      const results = isRecord(value) ? value.results : null;
      if (!Array.isArray(results) || results.length === 0) return null;
      return {
        name: 'place-carousel',
        // Parsing keeps only the fields a card shows; contact details and sources stay in the result.
        payload: { places: results },
      };
    }
    case 'suggest_replies':
      return { name: 'follow-up-chips', payload: value };
    case 'ask_choice':
      return { name: 'choice-card', payload: value };
    case 'check_availability': {
      if (!isRecord(value)) return null;
      const starts = value.starts;
      if (!Array.isArray(starts) || starts.length === 0) return null;
      return {
        name: 'availability-picker',
        // The picker shows local times and places left; instants stay in the result.
        payload: {
          offerId: value.offerId,
          date: value.date,
          quantity: value.quantity,
          starts: starts.map((s: Rec) => ({
            slotId: s.slotId,
            startsAtLocal: s.startsAtLocal,
            remaining: s.remaining,
          })),
        },
      };
    }
    case 'create_order':
      // Only a real Order gets a receipt; "not ordered" is told by the model's words.
      if (!isRecord(value) || value.outcome !== 'ordered') return null;
      return { name: 'receipt-card', payload: { order: value.order } };
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

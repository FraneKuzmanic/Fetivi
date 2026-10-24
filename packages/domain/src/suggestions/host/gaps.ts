import type { MessagePart } from '../../db/schema/conversations';
import { type GapTopic, isGapTopic } from './vocabulary';

/** The silent model tool that notes a property fact Fetivi could not answer (44 AC 1). */
export const GAP_TOOL_NAME = 'note_missing_info';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The gap topics an answer noted: distinct, in first-seen order, from successful
 * note_missing_info calls only. Reads nothing but the enum topic, so guest wording cannot get
 * in (44 AC 4). Parts are untyped jsonb, so the input is read defensively.
 */
export function gapTopics(parts: MessagePart[]): GapTopic[] {
  const seen = new Set<GapTopic>();
  for (const part of parts) {
    if (part.type !== `tool-${GAP_TOOL_NAME}` || part.state !== 'output-available') continue;
    const topic = isRecord(part.input) ? part.input.topic : null;
    if (isGapTopic(topic)) seen.add(topic);
  }
  return [...seen];
}

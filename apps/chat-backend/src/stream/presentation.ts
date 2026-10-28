import { GAP_TOOL_NAME, type GuestProjection } from '@fetivi/domain';
import { choiceCard, followUpChips, PROPERTY_INFO_TOPICS, propertyInfo } from '@fetivi/ui/payloads';
import {
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  tool,
} from 'ai';
import { z } from 'zod';

/** Host-side tools that only show a component; they are not MCP tools and touch no data. */
export const PRESENTATION_TOOLS = ['suggest_replies', 'ask_choice'] as const;
export type PresentationTool = (typeof PRESENTATION_TOOLS)[number];

export const isPresentationTool = (name: string): name is PresentationTool =>
  (PRESENTATION_TOOLS as readonly string[]).includes(name);

/**
 * The input schema is the component's payload schema, so an invalid payload is a tool error the
 * model sees. show_property_info is the exception: the model names only a topic, and the card is
 * filled from the unit record, so its component comes from the output.
 */
export function presentationTools(deps: {
  readProjection: () => Promise<GuestProjection>;
}): ToolSet {
  return {
    suggest_replies: tool({
      description:
        "Show 1–4 tappable follow-ups under your answer, written as the guest would say them, in the guest's language. Call this last, in the same response as your answer, and never together with another tool.",
      inputSchema: followUpChips,
      execute: async () => ({ shown: true }),
    }),
    ask_choice: tool({
      description:
        "Ask the guest to pick from 2–6 short options (multiple: true lets them pick several); the app adds 'Something else'. Use it instead of asking a multiple-choice question in prose. Call it last, never together with another tool.",
      inputSchema: choiceCard,
      execute: async () => ({ shown: true }),
    }),
    show_property_info: tool({
      description:
        "Show the guest a card with the unit's facts for one topic, with copy buttons for codes and passwords: arrival (check-in, access, codes), wifi, checkout (checkout time and house rules), contacts (112, host, emergency contact). Call this once, in the same response as your short answer; it ends your reply. The card is filled from the unit record, never from your words.",
      inputSchema: z.object({ topic: z.enum(PROPERTY_INFO_TOPICS) }),
      execute: async ({ topic }) => propertyInfo(await deps.readProjection(), topic),
    }),
  };
}

const answered = (steps: readonly StepResult<ToolSet>[]) =>
  steps.some((s) => s.text.trim().length > 0);

/**
 * Ends the turn like a presentation call: the card is the answer's last part. The silent gap note
 * (44) also ends it, so "I don't have that" plus the note costs no extra round trip.
 */
const endsTurn = (name: string) =>
  isPresentationTool(name) || name === 'show_property_info' || name === GAP_TOOL_NAME;

/**
 * Stops the loop after a step whose calls are all presentation calls or the property card: the
 * guest answers next, so another model round trip would only cost. A step that also searched
 * continues, so the model sees the results; so does one with an invalid call, so the model can
 * correct it. Chips or a card without any text in the turn continue too, so the guest never gets
 * them without words (a choice card carries its own question).
 */
export const endsWithPresentation: StopCondition<ToolSet> = ({ steps }) => {
  const calls = steps.at(-1)?.toolCalls ?? [];
  if (calls.length === 0) return false;
  if (!calls.every((c) => !c.invalid && endsTurn(c.toolName))) return false;
  return answered(steps) || calls.some((c) => c.toolName === 'ask_choice');
};

/**
 * The step after chips shown without text writes the answer. It is sent without that chips call
 * and may not call tools: after seeing its own chips acknowledged, Sonnet often ends the turn
 * empty, while from the search results it answers. The chips are already shown and stored.
 */
export const textAfterSilentChips: PrepareStepFunction<ToolSet> = ({ steps, messages }) => {
  const calls = steps.at(-1)?.toolCalls ?? [];
  const chips = calls.some((c) => !c.invalid && c.toolName === 'suggest_replies');
  if (!chips || answered(steps)) return undefined;
  const [call, result] = messages.slice(-2);
  const dropChips = call?.role === 'assistant' && result?.role === 'tool';
  return { toolChoice: 'none', ...(dropChips ? { messages: messages.slice(0, -2) } : {}) };
};

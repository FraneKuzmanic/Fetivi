import { GAP_TOOL_NAME, type GuestProjection } from '@fetivi/domain';
import { choiceCard, followUpChips, PROPERTY_INFO_TOPICS, propertyInfo } from '@fetivi/ui/payloads';
import {
  getToolName,
  isToolUIPart,
  type PrepareStepFunction,
  type StepResult,
  type StopCondition,
  type ToolSet,
  tool,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { SHOW_RESULTS_MAX, type TurnResults } from './results';

/** Host-side tools that only show a component; they are not MCP tools and touch no data. */
export const PRESENTATION_TOOLS = ['suggest_replies', 'ask_choice'] as const;
export type PresentationTool = (typeof PRESENTATION_TOOLS)[number];

export const isPresentationTool = (name: string): name is PresentationTool =>
  (PRESENTATION_TOOLS as readonly string[]).includes(name);

/**
 * The input schema is the component's payload schema, so an invalid payload is a tool error the
 * model sees. show_property_info is the exception: the model names only a topic, and the card is
 * filled from the unit record, so its component comes from the output. show_results draws cards
 * from this turn's search results (ticket 65); its component is kept by call id in `results`.
 */
export function presentationTools(deps: {
  readProjection: () => Promise<GuestProjection>;
  results: TurnResults;
}): ToolSet {
  return {
    suggest_replies: tool({
      description:
        "Show 1–4 tappable follow-ups under your answer, written as the guest would say them, in the guest's language. Call this last, in the same response as your answer, and never together with another tool except show_results. Never suggest something the guest declined or passed over earlier, unless they bring it up again. Set switchLanguage only when the guest's message is clearly written in another of Fetivi's languages than the one they chose: the app adds a chip that switches Fetivi to it.",
      inputSchema: followUpChips,
      execute: async () => ({ shown: true }),
    }),
    show_results: tool({
      description:
        "Show the places or events your answer recommends as cards, in the order your answer mentions them: kind 'places' for ids from search_places or list_host_picks, 'events' for ids from search_events, at most 5, only ids returned in this turn. Searches show the guest nothing by themselves. Never show a place you advise against or do not mention. Call it in the same response as your answer, before suggest_replies.",
      inputSchema: z.object({
        kind: z.enum(['places', 'events']),
        ids: z
          .array(z.string().min(1))
          .min(1)
          .max(SHOW_RESULTS_MAX)
          .refine((ids) => new Set(ids).size === ids.length, 'Each id once.'),
      }),
      execute: async ({ kind, ids }, { toolCallId }) => ({
        shown: deps.results.show(toolCallId, kind, ids),
      }),
    }),
    ask_choice: tool({
      description:
        "Ask the guest to pick from 2–6 short options (multiple: true lets them pick several); the app adds 'Something else'. Use it instead of asking a multiple-choice question in prose. Write your sentence first, then call it last, never together with another tool.",
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
  isPresentationTool(name) ||
  name === 'show_property_info' ||
  name === 'show_results' ||
  name === GAP_TOOL_NAME;

/**
 * draft_host_message in an emergency shows the contacts card instead of a draft: it ends the reply
 * like a property card, so the 112 and host instructions are said once (ticket 63). A draft is
 * followed by send_host_message, so it does not.
 */
const isEmergencyCard = (
  step: StepResult<ToolSet> | undefined,
  call: { toolName: string; toolCallId: string },
) =>
  call.toolName === 'draft_host_message' &&
  (step?.toolResults ?? []).some(
    (r) =>
      r.toolCallId === call.toolCallId &&
      (r.output as { outcome?: unknown } | null)?.outcome === 'emergency',
  );

/**
 * Stops the loop after a step whose calls are all presentation calls or the property card: the
 * guest answers next, so another model round trip would only cost. A step that also searched
 * continues, so the model sees the results; so does one with an invalid call or a tool error (e.g.
 * show_results with unknown ids), so the model can correct it. Chips, shown results, a choice
 * card or a property card without any text in the turn continue too, so the guest never gets them
 * without words (ticket 66). The emergency contacts card ends it the same way (ticket 63).
 */
export const endsWithPresentation: StopCondition<ToolSet> = ({ steps }) => {
  const last = steps.at(-1);
  const calls = last?.toolCalls ?? [];
  if (calls.length === 0) return false;
  if (!calls.every((c) => !c.invalid && (endsTurn(c.toolName) || isEmergencyCard(last, c))))
    return false;
  if (last?.content.some((p) => p.type === 'tool-error')) return false;
  return answered(steps);
};

/** Silent shows the words step is sent without: chips, a choice card, a property card (ticket 66). */
const WORDS_AFTER: readonly string[] = ['suggest_replies', 'ask_choice', 'show_property_info'];

/**
 * The step after chips, a choice or property card, or shown results without text writes the
 * answer, and may not call tools. A step of only such shows is sent without them: after seeing its
 * own chips acknowledged, Sonnet often ends the turn empty, while from the search results it
 * answers (tickets 60, 66). A step that also called another tool keeps it all, so no result the
 * words need is dropped. A step that showed results keeps only that call, so the words match the
 * cards: its chips call goes the same way, and so does the turn's thinking, which often holds the
 * whole answer and leaves the guard step to end empty (ticket 65). Both are already stored. A step
 * with an invalid call or a tool error keeps its tools, so the model can correct the call.
 */
export const textAfterSilentChips: PrepareStepFunction<ToolSet> = ({ steps, messages }) => {
  const last = steps.at(-1);
  const calls = last?.toolCalls ?? [];
  if (calls.some((c) => c.invalid)) return undefined;
  if (last?.content.some((p) => p.type === 'tool-error')) return undefined;
  // An emergency card counts as a show but keeps its call: the words must know the contacts
  // were shown (ticket 63).
  const shows = calls.some(
    (c) =>
      c.toolName === 'show_results' || WORDS_AFTER.includes(c.toolName) || isEmergencyCard(last, c),
  );
  if (!shows || answered(steps)) return undefined;
  const [call, result] = messages.slice(-2);
  if (call?.role !== 'assistant' || result?.role !== 'tool') return { toolChoice: 'none' };
  if (!calls.some((c) => c.toolName === 'show_results')) {
    const onlyShows = calls.every(
      (c) => WORDS_AFTER.includes(c.toolName) || c.toolName === GAP_TOOL_NAME,
    );
    return onlyShows
      ? { toolChoice: 'none', messages: messages.slice(0, -2) }
      : { toolChoice: 'none' };
  }
  const turnStart = messages.findLastIndex((m) => m.role === 'user');
  const kept = (p: { type: string }) =>
    p.type !== 'reasoning' && !('toolName' in p && p.toolName === 'suggest_replies');
  return {
    toolChoice: 'none',
    messages: messages.map((m, i) =>
      i > turnStart && (m.role === 'assistant' || m.role === 'tool') && Array.isArray(m.content)
        ? ({ ...m, content: m.content.filter(kept) } as typeof m)
        : m,
    ),
  };
};

const SHOWN_LAST: readonly string[] = [
  'suggest_replies',
  'show_results',
  'ask_choice',
  'show_property_info',
];
const isShownLast = (part: UIMessage['parts'][number]) =>
  isToolUIPart(part) && SHOWN_LAST.includes(getToolName(part));

/**
 * A stored answer resent to the model with its chips call after its last text, as if both came
 * in one response; a show_results call moves the same way, keeping its place before the chips
 * (ticket 65), and so do a choice and a property card (ticket 66). Rescued turns are stored
 * chips-then-text (the guard writes the words after the chips); resent in that order they teach
 * the model to call chips first, until the guard step has nothing it may say and ends empty
 * (ticket 60). Only the request changes: what is
 * stored and streamed keeps its order. A message without text, and every other part, stay as
 * they are. Pure, so the cached history prefix stays the same from turn to turn.
 */
export function chipsAfterText(message: UIMessage): UIMessage {
  if (message.role !== 'assistant') return message;
  const last = message.parts.findLastIndex((p) => p.type === 'text' && p.text.trim().length > 0);
  if (last < 0) return message;
  const moved = message.parts.slice(0, last).filter(isShownLast);
  if (moved.length === 0) return message;
  return {
    ...message,
    parts: [
      ...message.parts.slice(0, last + 1).filter((p) => !isShownLast(p)),
      ...moved,
      ...message.parts.slice(last + 1),
    ],
  };
}

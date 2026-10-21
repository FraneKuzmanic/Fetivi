import {
  COMPONENT_PART_TYPE,
  ELICITATION_PART_TYPE,
  elicitationPayload,
} from '@fetivi/ui/payloads';
import {
  convertToModelMessages,
  getToolName,
  type Instructions,
  isStepCount,
  isToolUIPart,
  type LanguageModel,
  readUIMessageStream,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOutcome,
  type UIMessageStreamWriter,
} from 'ai';
import type { FastifyBaseLogger } from 'fastify';
import { CHAT_PROVIDER_OPTIONS, MAX_OUTPUT_TOKENS, MAX_STEPS } from '../chat/model';
import type { ListedTool } from '../mcp/tools';
import { componentFor, withComponentParts } from '../stream/parts';
import { endsWithPresentation, textAfterSilentChips } from '../stream/presentation';
import type { TurnTools } from '../tools/registry';
import type { GuestAnswer, Outcome, PausedCall } from './elicitation';

// The turn loop around guest-confirmed tools. The AI SDK stops a step on a tool without
// `execute`; the loop then runs that call's first half and either shows the card (and ends the
// response) or writes the outcome and lets the model continue. Model segments and the loop's own
// chunks go through one writer in order, so the stored message matches what the browser saw.

export interface LoopDeps {
  model: LanguageModel;
  instructions: Instructions;
  tools: ToolSet;
  /** Guest-confirmed tools, each with the server that runs its halves. */
  paused: Map<string, ListedTool>;
  /** Runs the paused tools' halves, over MCP or in process. */
  turnTools: TurnTools;
  log: FastifyBaseLogger;
  /** Each guest tool call, for metrics. */
  onCall: (name: string) => void;
}

export interface LoopResult {
  outcome: UIMessageStreamOutcome;
  /** Model steps across every segment; 0 when no model ran. */
  steps: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

type ToolPart = Extract<UIMessage['parts'][number], { toolCallId: string; input?: unknown }>;

/** A paused call stored in a message: its tool part and its latest card, if one was shown. */
export interface OpenCall {
  part: ToolPart;
  toolName: string;
  listed: ListedTool;
  requestState: string | null;
}

/** The result a call gets when the guest moved on without confirming. */
const NOT_CONFIRMED = 'Not confirmed; nothing was booked.';

const emptyAssistant = (): UIMessage => ({ id: '', role: 'assistant', parts: [] });

/** Applies chunks to a copy of the message, as the browser does with the same chunks. */
async function applyChunks(message: UIMessage, chunks: UIMessageChunk[]): Promise<UIMessage> {
  const next = structuredClone(message);
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  // The accumulator updates `next` in place; reading to the end means every chunk is applied.
  for await (const _ of readUIMessageStream({ message: next, stream })) {
    // drained
  }
  return next;
}

/** Paused calls of a message still waiting for an answer (state input-available). */
export function openCalls(message: UIMessage, paused: Map<string, ListedTool>): OpenCall[] {
  const calls: OpenCall[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.state !== 'input-available') continue;
    const toolName = getToolName(part);
    const listed = paused.get(toolName);
    if (!listed) continue;
    const card = message.parts.find(
      (p) => p.type === ELICITATION_PART_TYPE && 'id' in p && p.id === part.toolCallId,
    );
    const parsed = elicitationPayload.safeParse(card && 'data' in card ? card.data : null);
    calls.push({
      part: part as ToolPart,
      toolName,
      listed,
      requestState: parsed.success ? parsed.data.requestState : null,
    });
  }
  return calls;
}

const pausedCall = (open: OpenCall): PausedCall => ({
  listed: open.listed,
  toolCallId: open.part.toolCallId,
  toolName: open.toolName,
  input: open.part.input,
});

/** The chunks that record one half's outcome on a paused call. */
function outcomeChunks(call: { toolCallId: string; toolName: string }, outcome: Outcome) {
  const { toolCallId } = call;
  switch (outcome.kind) {
    case 'ask':
      return [
        { type: ELICITATION_PART_TYPE, id: toolCallId, data: outcome.payload },
      ] as UIMessageChunk[];
    case 'error':
      return [
        { type: 'tool-output-error', toolCallId, errorText: outcome.errorText },
      ] as UIMessageChunk[];
    case 'output': {
      const chunks: UIMessageChunk[] = [
        { type: 'tool-output-available', toolCallId, output: outcome.output },
      ];
      const component = componentFor(call.toolName, outcome.output);
      if (component) chunks.push({ type: COMPONENT_PART_TYPE, id: toolCallId, data: component });
      return chunks;
    }
  }
}

/**
 * One response's loop. `assistant` is the message being continued (on resume) or null for a new
 * one; the caller writes nothing itself. Resolves when the response is complete or failed.
 */
export function createLoop(
  deps: LoopDeps,
  history: UIMessage[],
  assistant: UIMessage | null,
  writer: UIMessageStreamWriter,
) {
  let current = assistant ? structuredClone(assistant) : emptyAssistant();
  const result: LoopResult = {
    outcome: { status: 'completed' },
    steps: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  async function emit(chunks: UIMessageChunk[]) {
    for (const chunk of chunks) writer.write(chunk);
    current = await applyChunks(current, chunks);
  }

  /** One streamText run; false when the model failed. */
  async function segment(): Promise<boolean> {
    const messages = await convertToModelMessages(
      current.parts.length > 0 ? [...history, current] : history,
      { tools: deps.tools },
    );
    let outcome = { status: 'unknown' } as UIMessageStreamOutcome;
    const run = streamText({
      model: deps.model,
      instructions: deps.instructions,
      messages,
      // Only the server makes system messages: the request body carries nothing but text.
      allowSystemInMessages: true,
      tools: deps.tools,
      stopWhen: [isStepCount(MAX_STEPS - result.steps), endsWithPresentation],
      prepareStep: textAfterSilentChips,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: CHAT_PROVIDER_OPTIONS,
      onError: ({ error }) => deps.log.error({ err: error }, 'chat turn failed'),
    });
    const chunks: UIMessageChunk[] = [];
    // Read here, not merged: the next chunks (a card, an outcome) must follow these in order.
    // Reading to the end also runs the model to the end if the browser goes away.
    const stream = toUIMessageStream({
      stream: run.stream,
      tools: deps.tools,
      // Thinking is neither shown nor stored; earlier turns are resent without it.
      sendReasoning: false,
      // The loop writes one start and one finish around every segment.
      sendStart: false,
      sendFinish: false,
      onEnd: (event) => {
        outcome = event.outcome;
      },
      onError: () => 'turn-failed',
    }).pipeThrough(withComponentParts());
    for await (const chunk of stream) {
      writer.write(chunk);
      chunks.push(chunk);
    }
    current = await applyChunks(current, chunks);
    if (outcome.status !== 'completed') {
      result.outcome = outcome;
      return false;
    }
    const [steps, usage] = await Promise.all([run.steps, run.usage]);
    result.steps += steps.length;
    result.usage.input += usage.inputTokens ?? 0;
    result.usage.output += usage.outputTokens ?? 0;
    result.usage.cacheRead += usage.inputTokenDetails?.cacheReadTokens ?? 0;
    result.usage.cacheWrite += usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    return true;
  }

  /** Model segments until the model ends without a new paused call, or a card waits. */
  async function runModel(): Promise<void> {
    while (result.steps < MAX_STEPS) {
      if (!(await segment())) return;
      const fresh = openCalls(current, deps.paused).filter((c) => c.requestState === null);
      if (fresh.length === 0) return;
      let waiting = false;
      for (const open of fresh) {
        deps.onCall(open.toolName);
        const call = pausedCall(open);
        const outcome = await deps.turnTools.firstHalf(call);
        await emit(outcomeChunks(call, outcome));
        if (outcome.kind === 'ask') waiting = true;
      }
      // A refusal goes back to the model, which explains it in the same response.
      if (waiting) return;
    }
  }

  return {
    /** A new response: the model runs from the history. */
    async run(): Promise<LoopResult> {
      writer.write({ type: 'start' });
      await runModel();
      writer.write({ type: 'finish' });
      return result;
    },

    /** The guest's answer to one paused call of `assistant`, then the model continues. */
    async resume(
      open: OpenCall & { requestState: string },
      guest: GuestAnswer,
    ): Promise<LoopResult> {
      writer.write({ type: 'start' });
      deps.onCall(open.toolName);
      const call = pausedCall(open);
      const outcome = await deps.turnTools.answer({
        ...call,
        requestState: open.requestState,
        answer: { action: guest.action, content: guest.content },
      });
      await emit(outcomeChunks(call, outcome));
      // A card shown again, or another card still open: the guest answers next.
      if (outcome.kind !== 'ask' && openCalls(current, deps.paused).length === 0) await runModel();
      writer.write({ type: 'finish' });
      return result;
    },
  };
}

/**
 * Before a new guest text: every card still open in the last answer is cancelled through its tool
 * (the pending record is released; a tap that won the race reports its Order), so the model never
 * sees a tool call without a result. Returns the updated message, or null when nothing was open.
 * Nothing is streamed: the browser's response is a new message.
 */
export async function cancelOpenCalls(
  deps: Pick<LoopDeps, 'turnTools' | 'paused' | 'onCall'>,
  last: UIMessage | undefined,
): Promise<UIMessage | null> {
  if (last?.role !== 'assistant') return null;
  const open = openCalls(last, deps.paused);
  if (open.length === 0) return null;
  const chunks: UIMessageChunk[] = [];
  for (const call of open) {
    const paused = pausedCall(call);
    let outcome: Outcome = { kind: 'error', errorText: NOT_CONFIRMED };
    if (call.requestState !== null) {
      deps.onCall(call.toolName);
      outcome = await deps.turnTools.answer({
        ...paused,
        requestState: call.requestState,
        answer: { action: 'cancel' },
      });
    }
    // The server asking again cannot happen on a cancel; it would still leave a dangling call.
    if (outcome.kind === 'ask') outcome = { kind: 'error', errorText: NOT_CONFIRMED };
    chunks.push(...outcomeChunks(paused, outcome));
  }
  return applyChunks(last, chunks);
}

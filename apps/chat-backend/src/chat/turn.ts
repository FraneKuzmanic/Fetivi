import { randomUUID } from 'node:crypto';
import {
  appendTurn,
  type ConversationRow,
  type Db,
  findConversation,
  type GuestProjection,
  getAboutMe,
  getOrCreateConversation,
  loadMessages,
  loadSituation,
  type MessagePart,
  type MessageRow,
  type ResolvedSpace,
  recordTurnMetrics,
  type SpaceContext,
  type WeatherSource,
} from '@fetivi/domain';
import { INBOX_PART_TYPE, inboxItem } from '@fetivi/ui/payloads';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
} from 'ai';
import type { FastifyBaseLogger } from 'fastify';
import { HttpError } from '../http-error';
import type { GuestAnswer } from '../loop/elicitation';
import { gapTools } from '../loop/gap-topics';
import { cancelOpenCalls, createLoop, type LoopResult, openCalls } from '../loop/run';
import { type FirstPartyListed, pausedTools, toAiTools } from '../mcp/tools';
import {
  aboutMeNote,
  buildSystemText,
  hostReplyNote,
  projectionChangeNote,
  situationNote,
  systemInstructions,
  weatherNote,
} from '../prompt/prompt';
import { presentationTools } from '../stream/presentation';
import type { ToolBinding, TurnTools } from '../tools/registry';
import { CHAT_MODEL_ID } from './model';

export interface ChatDeps {
  db: Db;
  now: () => Date;
  /** Null when ANTHROPIC_API_KEY is unset. */
  model: LanguageModel | null;
  /** The guest tools: over MCP, or in process for V0 (TOOL_TRANSPORT). */
  tools: ToolBinding;
  /** Asked directly for the weather note, not over MCP, so a turn's MCP time stays the model's. */
  weather: WeatherSource;
  log: FastifyBaseLogger;
}

// Spaces with a turn running. In-process: there is one chat-backend process (architecture §4.1).
const running = new Set<string>();

export const rowToUiMessage = (row: Pick<MessageRow, 'id' | 'role' | 'parts'>) =>
  ({ id: row.id, role: row.role, parts: row.parts }) as UIMessage;

const toRow = (m: UIMessage) => ({
  id: m.id,
  role: m.role,
  parts: m.parts as unknown as MessagePart[],
});

/** The model's history: chat rows only. Inbox rows are the guest's, never the model's (ADR 0006). */
const chatHistory = (rows: MessageRow[]) =>
  rows.filter((r) => r.kind === 'chat').map(rowToUiMessage);

/**
 * The texts of host replies not yet noted for the model, and the seq they are noted up to. Rows
 * are compared with the conversation's mark, not with the last guest message: a reply stored while
 * a turn runs gets a lower seq than that turn's guest message, and must still reach the next turn.
 */
function newHostReplies(rows: MessageRow[], notedSeq: number) {
  const fresh = rows.filter((r) => r.kind === 'inbox' && r.seq > notedSeq);
  const texts = fresh
    .flatMap((r) => r.parts)
    .filter((p) => p.type === INBOX_PART_TYPE)
    .flatMap((p) => {
      const item = inboxItem.safeParse(p.data);
      // Only host replies are noted; notices (Order and Stay notifications) never reach the model.
      return item.success && item.data.kind === 'host-reply' ? [item.data.text] : [];
    });
  return { texts, notedSeq: Math.max(notedSeq, ...fresh.map((r) => r.seq)) };
}

const textMessage = (role: 'system' | 'user', text: string): UIMessage => ({
  id: randomUUID(),
  role,
  parts: [{ type: 'text', text }],
});

/** What both entries share: the lock, this turn's guest tools. */
interface OpenTurn {
  model: LanguageModel;
  spaceId: string;
  ctx: SpaceContext;
  startedAt: Date;
  t0: number;
  turnTools: TurnTools;
  tools: ToolSet;
  paused: Map<string, FirstPartyListed>;
  /** Guest tool calls of this turn, for metrics. */
  calls: string[];
}

/**
 * Takes the space's lock and opens the turn's guest tools, then runs `body`. Throws HttpError
 * before the stream starts; on any throw the tools close and the lock is released.
 * Otherwise `body`'s stream releases both when it ends.
 */
async function withTurn(
  deps: ChatDeps,
  space: ResolvedSpace,
  body: (turn: OpenTurn) => Promise<Response>,
): Promise<Response> {
  const { db, log, model } = deps;
  if (model === null) throw new HttpError(503, 'chat-unavailable');
  if (space.closed) throw new HttpError(409, 'space-closed');
  const spaceId = space.space.id;
  if (running.has(spaceId)) throw new HttpError(409, 'turn-in-progress');
  running.add(spaceId);

  const startedAt = deps.now();
  const t0 = performance.now();
  let opened: TurnTools | null = null;
  try {
    const ctx = await loadSituation(db, spaceId, startedAt);
    if (!ctx) throw new HttpError(401, 'no-space');
    const turnTools = await deps.tools.open(ctx, startedAt);
    opened = turnTools;
    const listed = await turnTools.list();
    const calls: string[] = [];
    const mcpTools = toAiTools(listed, { tools: turnTools, onCall: (n) => calls.push(n) });
    const hostSideTools = {
      ...presentationTools({ readProjection: () => turnTools.readProjection() }),
      ...gapTools(),
    };
    for (const name of Object.keys(hostSideTools)) {
      if (name in mcpTools) throw new Error(`A server exposes the host-side tool ${name}`);
    }
    return await body({
      model,
      spaceId,
      ctx,
      startedAt,
      t0,
      turnTools,
      tools: { ...mcpTools, ...hostSideTools },
      paused: pausedTools(listed),
      calls,
    });
  } catch (error) {
    await opened?.close();
    running.delete(spaceId);
    if (error instanceof HttpError) throw error;
    log.error({ err: error }, 'chat turn failed before streaming');
    throw new HttpError(502, 'turn-failed');
  }
}

/**
 * The response stream around one loop. The outer stream owns the message id and persistence, so
 * the stored answer holds the same parts, in the same order, as the browser saw. When the last
 * original message is the assistant's, the stream continues it (same id).
 */
function streamTurn(
  deps: ChatDeps,
  turn: OpenTurn,
  originalMessages: UIMessage[],
  run: (writer: UIMessageStreamWriter) => Promise<LoopResult>,
  persist: (responseMessage: UIMessage, result: LoopResult) => Promise<void>,
): Response {
  let result: LoopResult | null = null;
  const stream = createUIMessageStream({
    originalMessages,
    generateId: randomUUID,
    execute: async ({ writer }) => {
      const done = await run(writer);
      result = done;
      writer.setOutcome(done.outcome);
    },
    onEnd: async ({ responseMessage, outcome }) => {
      try {
        if (outcome.status === 'completed' && result) await persist(responseMessage, result);
      } catch (error) {
        deps.log.error({ err: error }, 'chat turn not stored');
      } finally {
        await turn.turnTools.close();
        running.delete(turn.spaceId);
      }
    },
    onError: (error) => {
      deps.log.error({ err: error }, 'chat turn failed');
      return 'turn-failed';
    },
  });
  return createUIMessageStreamResponse({ stream });
}

async function recordMetrics(
  deps: ChatDeps,
  turn: OpenTurn,
  conversationId: string,
  result: LoopResult,
): Promise<void> {
  await recordTurnMetrics(deps.db, {
    conversationId,
    model: CHAT_MODEL_ID,
    startedAt: turn.startedAt,
    wallMs: Math.round(performance.now() - turn.t0),
    mcpMs: Math.round(turn.turnTools.ms),
    transport: turn.turnTools.transport,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    cacheReadTokens: result.usage.cacheRead,
    cacheWriteTokens: result.usage.cacheWrite,
    steps: result.steps,
    toolCalls: turn.calls.length,
    toolNames: turn.calls,
  });
}

const loopDeps = (deps: ChatDeps, turn: OpenTurn, conversation: ConversationRow) => ({
  model: turn.model,
  instructions: systemInstructions(conversation.systemPrompt),
  tools: turn.tools,
  paused: turn.paused,
  turnTools: turn.turnTools,
  log: deps.log,
  onCall: (name: string) => turn.calls.push(name),
});

/**
 * The weather summary (architecture §4.3), asked of the weather source directly, not over MCP,
 * so the turn's MCP time stays the model's tool calls. Only inside a destination and before
 * checkout; null when the source fails, which keeps the last note.
 */
async function currentWeatherNote(
  deps: ChatDeps,
  turn: OpenTurn,
  projection: GuestProjection,
): Promise<string | null> {
  const { location, timezone } = projection.property;
  if (!turn.ctx.insideDestination || turn.ctx.phase === 'ended' || !location) return null;
  try {
    // English warnings: the note is for the model, which answers in the guest's language.
    const report = await deps.weather.report({ ...location, timezone }, 'en', turn.startedAt);
    return weatherNote(report, { now: turn.startedAt, timezone });
  } catch (err) {
    deps.log.warn({ err }, 'weather note skipped');
    return null;
  }
}

/**
 * One guest turn, streamed. Throws HttpError before the stream starts. The user message and the
 * answer are stored together only when the turn completes, so a failed turn leaves the history
 * (and the cached prompt prefix) as it was.
 */
export function runTurn(deps: ChatDeps, space: ResolvedSpace, text: string): Promise<Response> {
  return withTurn(deps, space, async (turn) => {
    const { db } = deps;
    const projection = await turn.turnTools.readProjection();
    const conversation = await getOrCreateConversation(
      db,
      turn.spaceId,
      { systemPrompt: buildSystemText(projection), projection },
      turn.startedAt,
    );
    const rows = await loadMessages(db, conversation.id);
    const history = chatHistory(rows);
    // A card still open when the guest types: the guest moved on, so it is cancelled first.
    const cancelled = await cancelOpenCalls(
      { turnTools: turn.turnTools, paused: turn.paused, onCall: (n) => turn.calls.push(n) },
      history.at(-1),
    );
    if (cancelled) history[history.length - 1] = cancelled;
    const aboutMeText = aboutMeNote(await getAboutMe(db, turn.spaceId), conversation.aboutMeNote);
    const replies = newHostReplies(rows, conversation.hostReplyNotedSeq);

    const note = situationNote({
      now: turn.startedAt,
      timezone: projection.property.timezone,
      checkIn: projection.stay.checkIn,
      checkout: projection.stay.checkout,
      phase: turn.ctx.phase,
    });
    const weatherText = await currentWeatherNote(deps, turn, projection);
    const notes = [
      projectionChangeNote(conversation.projection, projection),
      note === conversation.situationNote ? null : note,
      weatherText === null || weatherText === conversation.weatherNote ? null : weatherText,
      aboutMeText === conversation.aboutMeNote ? null : aboutMeText,
      hostReplyNote(replies.texts),
    ].filter((n) => n !== null);
    // Anthropic takes a mid-conversation system message only right after a user message, and not
    // two in a row: so the notes go after the guest's text, joined into one message.
    const newMessages: UIMessage[] = [textMessage('user', text)];
    if (notes.length > 0) newMessages.push(textMessage('system', notes.join('\n\n')));
    const originalMessages = [...history, ...newMessages];

    return streamTurn(
      deps,
      turn,
      originalMessages,
      (writer) =>
        createLoop(loopDeps(deps, turn, conversation), originalMessages, null, writer).run(),
      async (responseMessage, result) => {
        await appendTurn(db, {
          conversationId: conversation.id,
          messages: [...newMessages, responseMessage].map(toRow),
          updated: cancelled ? [toRow(cancelled)] : [],
          projection,
          situationNote: note,
          aboutMeNote: aboutMeText ?? conversation.aboutMeNote,
          weatherNote: weatherText ?? conversation.weatherNote,
          hostReplyNotedSeq: replies.notedSeq,
          now: deps.now(),
        });
        await recordMetrics(deps, turn, conversation.id, result);
      },
    );
  });
}

/**
 * The guest's answer to a card, streamed into the same assistant message. The paused call and
 * its `requestState` come from the stored message, never from the browser; nothing is kept in
 * process between requests. A model failure after the tap is not stored: the card stays open and
 * a second tap returns the same Order (the server deduplicates on the pending record).
 */
export function resumeTurn(
  deps: ChatDeps,
  space: ResolvedSpace,
  guest: GuestAnswer,
): Promise<Response> {
  return withTurn(deps, space, async (turn) => {
    const { db } = deps;
    const conversation = await findConversation(db, turn.spaceId);
    if (!conversation) throw new HttpError(409, 'nothing-to-answer');
    const history = chatHistory(await loadMessages(db, conversation.id));
    const assistant = history.at(-1);
    const open =
      assistant?.role === 'assistant'
        ? openCalls(assistant, turn.paused).find((c) => c.part.toolCallId === guest.toolCallId)
        : undefined;
    if (!assistant || !open || open.requestState === null) {
      throw new HttpError(409, 'nothing-to-answer');
    }
    const requestState = open.requestState;
    // No new user message, so no notes: Anthropic takes a system message only after a user one.
    return streamTurn(
      deps,
      turn,
      history,
      (writer) =>
        createLoop(
          loopDeps(deps, turn, conversation),
          history.slice(0, -1),
          assistant,
          writer,
        ).resume({ ...open, requestState }, guest),
      async (responseMessage, result) => {
        await appendTurn(db, {
          conversationId: conversation.id,
          messages: [],
          updated: [toRow(responseMessage)],
          projection: conversation.projection,
          situationNote: conversation.situationNote,
          aboutMeNote: conversation.aboutMeNote,
          now: deps.now(),
        });
        if (result.steps > 0) await recordMetrics(deps, turn, conversation.id, result);
      },
    );
  });
}

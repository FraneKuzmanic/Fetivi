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
  MCP_SERVERS,
  type McpServerName,
  type MessagePart,
  type MessageRow,
  type ResolvedSpace,
  recordTurnMetrics,
  type SpaceContext,
  scopesFor,
  UNIT_RESOURCE_URI,
} from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
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
import { cancelOpenCalls, createLoop, type LoopResult, openCalls } from '../loop/run';
import { openTurnClients, type TurnClients } from '../mcp/clients';
import {
  type ListedTool,
  listTurnTools,
  pausedTools,
  type ToolCatalog,
  toAiTools,
} from '../mcp/tools';
import {
  aboutMeNote,
  buildSystemText,
  projectionChangeNote,
  situationNote,
  systemInstructions,
} from '../prompt/prompt';
import { presentationTools } from '../stream/presentation';
import { mintServerTokens, type TokenConfig } from '../tokens/mint';
import { CHAT_MODEL_ID } from './model';

export interface ChatDeps {
  db: Db;
  now: () => Date;
  tokens: TokenConfig;
  /** Null when ANTHROPIC_API_KEY is unset. */
  model: LanguageModel | null;
  /** Outbound fetch to the MCP servers (egress; tests rewrite the host). */
  mcpFetch: Egress['fetch'];
  catalog: ToolCatalog;
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

const textMessage = (role: 'system' | 'user', text: string): UIMessage => ({
  id: randomUUID(),
  role,
  parts: [{ type: 'text', text }],
});

/** The unit record as the stay server shows it to this guest now. Never cached: it is how changes are seen. */
async function readProjection(clients: TurnClients): Promise<GuestProjection> {
  const result = await clients.timed(async () =>
    (await clients.get('stay')).readResource({ uri: UNIT_RESOURCE_URI }),
  );
  const content = result.contents[0];
  if (!content || !('text' in content) || typeof content.text !== 'string') {
    throw new Error('unit record without text');
  }
  return JSON.parse(content.text) as GuestProjection;
}

/** What both entries share: the lock, this turn's MCP clients and tools. */
interface OpenTurn {
  model: LanguageModel;
  spaceId: string;
  ctx: SpaceContext;
  startedAt: Date;
  t0: number;
  clients: TurnClients;
  tools: ToolSet;
  paused: Map<string, ListedTool>;
  /** MCP tool calls of this turn, for metrics. */
  calls: string[];
}

/**
 * Takes the space's lock and opens the turn's MCP clients and tools, then runs `body`. Throws
 * HttpError before the stream starts; on any throw the clients close and the lock is released.
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
  let clients: TurnClients | null = null;
  try {
    const ctx = await loadSituation(db, spaceId, startedAt);
    if (!ctx) throw new HttpError(401, 'no-space');
    const tokens = await mintServerTokens(deps.tokens, ctx, startedAt);
    const turnClients = openTurnClients({
      tokens,
      baseUrl: deps.tokens.mcpBaseUrl,
      fetch: deps.mcpFetch,
    });
    clients = turnClients;
    const scopes = Object.fromEntries(
      MCP_SERVERS.map((s) => [s, scopesFor(s, ctx).join(' ')]),
    ) as Record<McpServerName, string>;
    const listed = await listTurnTools(deps.catalog, turnClients, scopes);
    const calls: string[] = [];
    const mcpTools = toAiTools(listed, { clients: turnClients, onCall: (n) => calls.push(n) });
    const shownTools = presentationTools();
    for (const name of Object.keys(shownTools)) {
      if (name in mcpTools) throw new Error(`A server exposes the presentation tool ${name}`);
    }
    return await body({
      model,
      spaceId,
      ctx,
      startedAt,
      t0,
      clients: turnClients,
      tools: { ...mcpTools, ...shownTools },
      paused: pausedTools(listed),
      calls,
    });
  } catch (error) {
    await clients?.close();
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
        await turn.clients.close();
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
    mcpMs: Math.round(turn.clients.mcpMs),
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
  clients: turn.clients,
  log: deps.log,
  onCall: (name: string) => turn.calls.push(name),
});

/**
 * One guest turn, streamed. Throws HttpError before the stream starts. The user message and the
 * answer are stored together only when the turn completes, so a failed turn leaves the history
 * (and the cached prompt prefix) as it was.
 */
export function runTurn(deps: ChatDeps, space: ResolvedSpace, text: string): Promise<Response> {
  return withTurn(deps, space, async (turn) => {
    const { db } = deps;
    const projection = await readProjection(turn.clients);
    const conversation = await getOrCreateConversation(
      db,
      turn.spaceId,
      { systemPrompt: buildSystemText(projection), projection },
      turn.startedAt,
    );
    const history = (await loadMessages(db, conversation.id)).map(rowToUiMessage);
    // A card still open when the guest types: the guest moved on, so it is cancelled first.
    const cancelled = await cancelOpenCalls(
      { clients: turn.clients, paused: turn.paused, onCall: (n) => turn.calls.push(n) },
      history.at(-1),
    );
    if (cancelled) history[history.length - 1] = cancelled;
    const aboutMeText = aboutMeNote(await getAboutMe(db, turn.spaceId), conversation.aboutMeNote);

    const note = situationNote({
      now: turn.startedAt,
      timezone: projection.property.timezone,
      checkIn: projection.stay.checkIn,
      checkout: projection.stay.checkout,
      phase: turn.ctx.phase,
    });
    const notes = [
      projectionChangeNote(conversation.projection, projection),
      note === conversation.situationNote ? null : note,
      aboutMeText === conversation.aboutMeNote ? null : aboutMeText,
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
    const history = (await loadMessages(db, conversation.id)).map(rowToUiMessage);
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

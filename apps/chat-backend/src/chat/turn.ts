import { randomUUID } from 'node:crypto';
import {
  appendTurn,
  type Db,
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
  scopesFor,
  UNIT_RESOURCE_URI,
} from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  type LanguageModel,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import type { FastifyBaseLogger } from 'fastify';
import { HttpError } from '../http-error';
import { openTurnClients, type TurnClients } from '../mcp/clients';
import { listTurnTools, type ToolCatalog, toAiTools } from '../mcp/tools';
import {
  aboutMeNote,
  buildSystemText,
  projectionChangeNote,
  situationNote,
  systemInstructions,
} from '../prompt/prompt';
import { withComponentParts } from '../stream/parts';
import { endsWithPresentation, presentationTools } from '../stream/presentation';
import { mintServerTokens, type TokenConfig } from '../tokens/mint';
import { CHAT_MODEL_ID, CHAT_PROVIDER_OPTIONS, MAX_OUTPUT_TOKENS, MAX_STEPS } from './model';

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

/**
 * One guest turn, streamed. Throws HttpError before the stream starts. The user message and the
 * answer are stored together only when the turn completes, so a failed turn leaves the history
 * (and the cached prompt prefix) as it was.
 */
export async function runTurn(
  deps: ChatDeps,
  space: ResolvedSpace,
  text: string,
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
    const projection = await readProjection(turnClients);

    const conversation = await getOrCreateConversation(
      db,
      spaceId,
      { systemPrompt: buildSystemText(projection), projection },
      startedAt,
    );
    const history = await loadMessages(db, conversation.id);
    const aboutMeText = aboutMeNote(await getAboutMe(db, spaceId), conversation.aboutMeNote);

    const note = situationNote({
      now: startedAt,
      timezone: projection.property.timezone,
      checkIn: projection.stay.checkIn,
      checkout: projection.stay.checkout,
      phase: ctx.phase,
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
    const tools = { ...mcpTools, ...shownTools };

    const originalMessages = [...history.map(rowToUiMessage), ...newMessages];
    const messages = await convertToModelMessages(originalMessages, { tools });
    const result = streamText({
      model,
      instructions: systemInstructions(conversation.systemPrompt),
      messages,
      // Only the server makes system messages: the request body carries nothing but text.
      allowSystemInMessages: true,
      tools,
      stopWhen: [isStepCount(MAX_STEPS), endsWithPresentation],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: CHAT_PROVIDER_OPTIONS,
      onError: ({ error }) => log.error({ err: error }, 'chat turn failed'),
    });

    const persist = async (responseMessage: UIMessage) => {
      const usage = await result.usage;
      const steps = (await result.steps).length;
      await appendTurn(db, {
        conversationId: conversation.id,
        messages: [...newMessages, responseMessage].map(toRow),
        projection,
        situationNote: note,
        aboutMeNote: aboutMeText ?? conversation.aboutMeNote,
        now: deps.now(),
      });
      await recordTurnMetrics(db, {
        conversationId: conversation.id,
        model: CHAT_MODEL_ID,
        startedAt,
        wallMs: Math.round(performance.now() - t0),
        mcpMs: Math.round(turnClients.mcpMs),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        steps,
        toolCalls: calls.length,
        toolNames: calls,
      });
    };

    // The outer stream owns the message id and persistence, so the stored answer holds the same
    // component parts, in the same order, as the browser saw.
    const stream = createUIMessageStream({
      originalMessages,
      generateId: randomUUID,
      execute: ({ writer }) => {
        writer.merge(
          toUIMessageStream({
            stream: result.stream,
            tools,
            // Thinking is neither shown nor stored; earlier turns are resent without it.
            sendReasoning: false,
            // The model run decides whether the turn completed; the outer stream only adds parts.
            onEnd: ({ outcome }) => writer.setOutcome(outcome),
            onError: () => 'turn-failed',
          }).pipeThrough(withComponentParts()),
        );
      },
      onEnd: async ({ responseMessage, outcome }) => {
        try {
          if (outcome.status === 'completed') await persist(responseMessage);
        } catch (error) {
          log.error({ err: error }, 'chat turn not stored');
        } finally {
          await turnClients.close();
          running.delete(spaceId);
        }
      },
      onError: () => 'turn-failed',
    });
    const response = createUIMessageStreamResponse({ stream });
    // Runs the model to the end even if the browser goes away.
    void Promise.resolve(result.consumeStream()).catch(() => {});
    return response;
  } catch (error) {
    await clients?.close();
    running.delete(spaceId);
    if (error instanceof HttpError) throw error;
    log.error({ err: error }, 'chat turn failed before streaming');
    throw new HttpError(502, 'turn-failed');
  }
}

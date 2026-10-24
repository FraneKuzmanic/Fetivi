import { randomUUID } from 'node:crypto';
import { destinations, findConversation, turnMetrics } from '@fetivi/domain';
import { seedGuestUnit, TROGIR } from '@fetivi/domain/testing';
import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, readStream, write } from '../testing';

// No instrumentations are registered: no HTTP header carries the context, so only the MCP
// request's `_meta` can connect the server's spans to the turn.
const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

beforeEach(() => {
  exporter.reset();
});

const apps: ChatTestApp[] = [];
afterAll(async () => {
  await Promise.all(apps.map((t) => t.close()));
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

type StreamResult = { stream: ReadableStream<unknown> };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

const toolStep = (): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'probe_situation',
        input: '{"topic":"wifi"}',
      },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
    ],
  }),
});

const textStep = (): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hall.' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
    ],
  }),
});

const mockModel = (steps: StreamResult[]) => new MockLanguageModelV4({ doStream: steps as never });

async function setup(t: ChatTestApp) {
  apps.push(t);
  // Inside a destination, so the `local` token carries catalog:read and the probe is listed.
  await t.db
    .insert(destinations)
    .values({ name: `Trogir ${randomUUID()}`, centre: TROGIR, radiusM: 10_000 });
  const seed = await seedGuestUnit(t.db, {
    now: t.clock.now(),
    checkInInDays: 2,
    releaseDaysBefore: 1,
  });
  const { cookie, space } = await enterSpace(t, seed);
  return { cookie, spaceId: space.space.id };
}

async function turn(t: ChatTestApp, cookie: string, text: string) {
  const response = await write('POST', t.app, '/api/chat', { text }, { cookie });
  expect(response.statusCode).toBe(200);
  readStream(response);
}

async function metricRows(t: ChatTestApp, spaceId: string) {
  const conversation = await findConversation(t.db, spaceId);
  if (!conversation) throw new Error('no conversation');
  return t.db.select().from(turnMetrics).where(eq(turnMetrics.conversationId, conversation.id));
}

/** Waits for `count` finished turn spans: they end after the response, in the stream's onEnd. */
async function turnSpans(count: number): Promise<ReadableSpan[]> {
  await vi.waitFor(() =>
    expect(exporter.getFinishedSpans().filter((s) => s.name === 'chat.turn')).toHaveLength(count),
  );
  return exporter.getFinishedSpans().filter((s) => s.name === 'chat.turn');
}

const one = (spans: ReadableSpan[], predicate: (s: ReadableSpan) => boolean) => {
  const found = spans.filter(predicate);
  expect(found).toHaveLength(1);
  return found[0] as ReadableSpan;
};

describe('tracing a guest turn', () => {
  it('produces one connected trace across the chat backend and the MCP server', async () => {
    const t = await createChatTestApp({ model: mockModel([toolStep(), textStep()]), probe: true });
    const { cookie, spaceId } = await setup(t);
    const secret = `What about the wifi ${randomUUID()}?`;

    await turn(t, cookie, secret);
    const [turnSpan] = await turnSpans(1);
    if (!turnSpan) throw new Error('no turn span');
    // The server span ends on reply close, which may come after the turn's end.
    await vi.waitFor(() =>
      expect(
        exporter
          .getFinishedSpans()
          .some((s) => s.name === 'tools/call probe_situation' && s.kind === SpanKind.SERVER),
      ).toBe(true),
    );
    const spans = exporter.getFinishedSpans();
    const { traceId, spanId: turnSpanId } = turnSpan.spanContext();

    const client = one(
      spans,
      (s) => s.name === 'tools/call probe_situation' && s.kind === SpanKind.CLIENT,
    );
    const server = one(
      spans,
      (s) => s.name === 'tools/call probe_situation' && s.kind === SpanKind.SERVER,
    );
    const work = one(spans, (s) => s.name === 'probe work');
    const reads = spans.filter((s) => s.name.startsWith('resources/read'));
    expect(reads.length).toBeGreaterThan(0);

    // (a) One trace.
    for (const s of [client, server, work, ...reads]) {
      expect(s.spanContext().traceId).toBe(traceId);
    }
    // (b) The server's parent is the client request, carried in `_meta`; the client's is the turn.
    expect(client.parentSpanContext?.spanId).toBe(turnSpanId);
    expect(server.parentSpanContext?.spanId).toBe(client.spanContext().spanId);
    expect(server.parentSpanContext?.isRemote).toBe(true);
    // (c) The tool's work nests inside the server span.
    expect(work.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
    // (d) Each side's spans come from its own process' tracer.
    expect(server.instrumentationScope.name).toBe('@fetivi/mcp-servers');
    expect(client.instrumentationScope.name).toBe('@fetivi/chat-backend');
    expect(client.attributes).toMatchObject({
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'probe_situation',
      'fetivi.mcp.server': 'local',
    });

    // (e) The metric row leads to the trace.
    const rows = await metricRows(t, spaceId);
    expect(rows.map((r) => r.traceId)).toEqual([traceId]);

    // (f) No guest text in any span.
    const attributes = JSON.stringify(spans.map((s) => s.attributes));
    expect(attributes).not.toContain(secret);
    expect(attributes).not.toContain('wifi');
  });

  it('gives each turn its own trace and row', async () => {
    const t = await createChatTestApp({ model: mockModel([textStep(), textStep()]) });
    const { cookie, spaceId } = await setup(t);

    await turn(t, cookie, 'Hello');
    await turnSpans(1);
    await turn(t, cookie, 'Again');
    const turns = await turnSpans(2);

    const ids = turns.map((s) => s.spanContext().traceId);
    expect(new Set(ids).size).toBe(2);
    const rows = await metricRows(t, spaceId);
    expect(rows.map((r) => r.traceId).sort()).toEqual([...ids].sort());
  });

  it('traces a V0 turn without MCP spans', async () => {
    const t = await createChatTestApp({ model: mockModel([textStep()]), transport: 'inprocess' });
    const { cookie, spaceId } = await setup(t);

    await turn(t, cookie, 'Hello');
    const [turnSpan] = await turnSpans(1);
    expect(turnSpan?.attributes['fetivi.tool_transport']).toBe('inprocess');
    expect(exporter.getFinishedSpans().some((s) => s.name.startsWith('tools/'))).toBe(false);
    const rows = await metricRows(t, spaceId);
    expect(rows.map((r) => r.traceId)).toEqual([turnSpan?.spanContext().traceId]);
  });
});

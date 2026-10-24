import { context, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { traceRoutes } from './routes';

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

describe('traceRoutes', () => {
  it('names the span after the route template and keeps no path secret or query', async () => {
    const app = Fastify();
    traceRoutes(app);
    app.get('/api/access/:slug', async () => ({ ok: true }));

    const span = trace.getTracer('test').startSpan('GET', {
      attributes: { 'url.path': '/api/access/SECRET', 'url.query': 'x=1' },
    });
    // Awaited inside: inject is a lazy thenable that starts only when awaited.
    const res = await context.with(
      trace.setSpan(context.active(), span),
      async () => await app.inject({ url: '/api/access/SECRET?x=1' }),
    );
    span.end();
    expect(res.statusCode).toBe(200);

    const [finished] = exporter.getFinishedSpans();
    expect(finished?.name).toBe('GET /api/access/:slug');
    expect(finished?.attributes['url.path']).toBe('/api/access/:slug');
    expect(finished?.attributes['http.route']).toBe('/api/access/:slug');
    expect(finished?.attributes['url.query']).toBe('redacted');
    expect(JSON.stringify(finished?.attributes)).not.toContain('SECRET');
    await app.close();
  });
});

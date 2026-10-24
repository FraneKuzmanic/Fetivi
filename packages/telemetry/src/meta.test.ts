import { context, propagation, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextFromMeta, traceMeta } from './meta';

let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider();
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

describe('traceMeta / contextFromMeta', () => {
  it('round-trips the active span through `_meta`', () => {
    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('outer', (span) => {
      const meta = traceMeta();
      // The SEP-414 key, equal to the SDK's TRACEPARENT_META_KEY.
      expect(Object.keys(meta)).toContain('traceparent');
      expect(meta.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      const { traceId, spanId } = span.spanContext();
      expect(meta.traceparent).toBe(`00-${traceId}-${spanId}-01`);

      const remote = trace.getSpanContext(contextFromMeta(meta));
      expect(remote).toMatchObject({ traceId, spanId, isRemote: true });
      span.end();
    });
  });

  it('falls back to the active context without a string traceparent', () => {
    const active = context.active();
    expect(contextFromMeta(undefined)).toBe(active);
    expect(contextFromMeta({ traceparent: 5 })).toBe(active);
  });

  it('adds no keys outside a span', () => {
    expect(traceMeta()).toEqual({});
  });
});

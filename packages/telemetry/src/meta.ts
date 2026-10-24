import { type Context, context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';

/**
 * W3C trace context in an MCP request's `_meta` (SEP-414). The keys equal the SDK's
 * `TRACEPARENT_META_KEY`, `TRACESTATE_META_KEY` and `BAGGAGE_META_KEY`.
 */
export type TraceMeta = { traceparent?: string; tracestate?: string; baggage?: string };

const KEYS = ['traceparent', 'tracestate', 'baggage'] as const;

/** The trace context of `ctx` as `_meta` keys; empty when no propagator is registered (tracing off). */
export function traceMeta(ctx: Context = context.active()): TraceMeta {
  const carrier: Record<string, unknown> = {};
  propagation.inject(ctx, carrier);
  const meta: TraceMeta = {};
  for (const key of KEYS) {
    const value = carrier[key];
    if (typeof value === 'string') meta[key] = value;
  }
  return meta;
}

/** The remote parent carried in a request's `_meta`, or the active context when it carries none. */
export function contextFromMeta(meta: unknown): Context {
  if (typeof meta !== 'object' || meta === null) return context.active();
  const carrier = meta as Record<string, unknown>;
  if (typeof carrier.traceparent !== 'string') return context.active();
  const strings: Record<string, string> = {};
  for (const key of KEYS) {
    const value = carrier[key];
    if (typeof value === 'string') strings[key] = value;
  }
  return propagation.extract(ROOT_CONTEXT, strings);
}

/**
 * The span name and attributes of one MCP request (OTel MCP conventions): method and target
 * only, never arguments. Shared by the client and server spans so both sides read alike.
 */
export function mcpSpan(
  method: string,
  target: string | null,
): { name: string; attributes: Record<string, string> } {
  return {
    name: target ? `${method} ${target}` : method,
    attributes: {
      'mcp.method.name': method,
      ...(target && method === 'tools/call'
        ? { 'gen_ai.tool.name': target, 'gen_ai.operation.name': 'execute_tool' }
        : {}),
      ...(target && method === 'resources/read' ? { 'mcp.resource.uri': target } : {}),
    },
  };
}

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/**
 * The URL attributes of an outgoing request, origin only: queries can carry guest text (a Brave
 * search) and paths can carry secrets (a web push endpoint ends in the subscription token).
 */
export function outgoingUrl(origin: string): Record<string, string> {
  return { 'url.full': origin, 'url.path': 'redacted', 'url.query': 'redacted' };
}

/**
 * Tracing for one process: http in and out, fetch (undici) and pg, batched to OTLP over HTTP.
 * The exporter reads `OTEL_EXPORTER_OTLP_ENDPOINT` itself (default http://localhost:4318); when
 * Jaeger is down the batch is dropped and requests are unaffected. Null when `OTEL_SDK_DISABLED`.
 */
export function startTelemetry(serviceName: string): NodeTracerProvider | null {
  if (process.env.OTEL_SDK_DISABLED === 'true') return null;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/health' }),
      new UndiciInstrumentation({
        requestHook: (span, request) => span.setAttributes(outgoingUrl(request.origin)),
      }),
      // pg-boss polls with no parent; only queries inside a trace are worth a span.
      new PgInstrumentation({ requireParentSpan: true }),
    ],
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void provider.shutdown());
  }
  return provider;
}

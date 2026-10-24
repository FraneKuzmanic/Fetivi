# 0022: Jaeger v2 is the collector, and MCP server spans take their parent from `_meta`

**Status:** accepted, 2026-10-24 (ticket 46)

## Context

Architecture §5 asks for "an OpenTelemetry collector and Jaeger in the Compose stack", and the Observability row asks for trace context carried in MCP `_meta`. The chat backend reaches the MCP servers over HTTP, so the HTTP instrumentation also sends a `traceparent` header on each MCP request. The thesis needs the MCP hop of each tool call isolated in one trace.

## Decision

- **One container**: `jaegertracing/jaeger:2.22.0` in `docker-compose.yml`. Jaeger v2 is an OpenTelemetry Collector distribution: it takes OTLP over HTTP on 4318 and serves the UI on 16686. Every process exports to it directly with the OTLP HTTP exporter.
- **The MCP server span's parent is `params._meta`** (`traceparent`, `tracestate`; SEP-414), not the HTTP header. The client span injects it per request in `TurnClients.call`; `mountServer` extracts it.

## Rejected

- A separate `otel/opentelemetry-collector` container in front of Jaeger: more configuration and nothing a local setup needs. It can be added later without touching the apps, since they only know `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Parenting from the HTTP header: it ties the trace to the transport, so it breaks for any non-HTTP transport and for requests sent outside the instrumented `fetch`. `_meta` is what the MCP spec defines.

## Consequences

- Traces live in Jaeger's memory and are gone when the container restarts.
- A trace shows both the HTTP CLIENT span and the MCP CLIENT span for each call; the MCP SERVER span sits under the MCP CLIENT span.

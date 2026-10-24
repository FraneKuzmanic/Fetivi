# Observability: traces in Jaeger (ticket 46)

How the server processes are traced with OpenTelemetry, how to open one guest turn as a trace, and what a trace may contain.

## What is traced

Four processes, each loaded with `--import ./src/instrumentation.ts` before the app:

| Process | Service name in Jaeger |
|---|---|
| `apps/chat-backend` | `fetivi-chat-backend` |
| `apps/mcp-servers` | `fetivi-mcp-servers` |
| `apps/backoffice-api` | `fetivi-backoffice-api` |
| `apps/jobs` | `fetivi-jobs` |

In each of them:

- **HTTP in**: one SERVER span per request, named after its route template (`POST /api/chat`). `/health` is not traced.
- **HTTP out**: one CLIENT span per `fetch` (Anthropic, Brave, weather, Stripe, the MCP requests themselves).
- **Postgres**: one span per query, only inside a trace. pg-boss polls every 2 seconds and those queries are left out.
- **pg-boss**: `send <queue>` when a job is sent and `process <queue>` when it runs. A job sent during a traced request continues that trace when it runs, so a turn's mails and timers show up in its trace.
- **The MCP hop**: every first-party MCP request (`tools/call`, `tools/list`, `resources/read`, both halves of an elicitation) is a CLIENT span in the chat backend and a SERVER span in the MCP server process. The trace context travels in the request's `params._meta` (`traceparent`, `tracestate`; MCP SEP-414), and the server span takes its parent from there, not from the HTTP header. Ferryhopper gets no `_meta` trace context: it is external. Its calls still show as the HTTP span of the egress fetch.
- **The turn**: `chat.turn` wraps one guest turn, with `fetivi.turn.kind` (`message` or `answer`) and `fetivi.tool_transport` (`mcp` or `inprocess`). Its trace id is stored on the turn's `turn_metrics` row (`trace_id`). A card answer is its own turn and its own trace.

V0 (`TOOL_TRANSPORT=inprocess`) turns get the `chat.turn` span and a `trace_id`, but no per-tool spans.

## Run

1. `pnpm db:up` starts Postgres and Jaeger.
2. `pnpm dev`.
3. Open the Jaeger UI at http://localhost:16686.

## Open a turn's trace

From a metric row:

```sql
select started_at, trace_id from turn_metrics order by started_at desc limit 5;
```

then open `http://localhost:16686/trace/<trace_id>`.

Or in the Jaeger UI: Service `fetivi-chat-backend`, Operation `chat.turn`, **Find Traces**.

## Reading a turn

```
chat.turn                                    fetivi-chat-backend
├─ POST  (api.anthropic.com)                 the model call, one per step
├─ tools/call get_offers          CLIENT     fetivi-chat-backend
│  ├─ POST  (mcp-servers)                    the HTTP request under it
│  └─ tools/call get_offers       SERVER     fetivi-mcp-servers
│     ├─ pg.query …                          the tool's queries
│     └─ send <queue>                        jobs the tool sends
└─ pg.query …                                storing the turn and its metric row
```

The client `tools/call` span minus the server `tools/call` span is the MCP transport overhead for that call: serialization, HTTP and token checks. `turn_metrics.mcp_ms` stays the per-turn aggregate; the trace gives the per-call breakdown.

## Privacy

Spans hold no guest text:

- Route templates instead of paths, since paths carry access slugs and one-time link tokens. Incoming query strings are replaced by `redacted`.
- Outgoing URLs without their query string, since a Brave search query is guest text.
- SQL statements without values.
- No prompt, message, tool argument or tool result text. The AI SDK's own telemetry stays off.

## Settings

The SDK's own environment variables, documented in each app's `.env.example`:

- `OTEL_SDK_DISABLED=true` switches tracing off in that process. `trace_id` is then null.
- `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`). When Jaeger is down, spans are dropped and requests are unaffected.

Jaeger keeps traces in memory only: they are gone when the container restarts.

## Why one container

Architecture §5 asks for "an OpenTelemetry collector and Jaeger in the Compose stack". Jaeger v2 (`jaegertracing/jaeger:2.22.0`) is an OpenTelemetry Collector distribution: it receives OTLP over HTTP on 4318 and serves the UI on 16686. A separate collector container would add configuration and nothing a local setup needs.

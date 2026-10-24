import { type McpServerName, serverUrl } from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import { mcpSpan, type TraceMeta, traceMeta } from '@fetivi/telemetry';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { TurnTokens } from '../tokens/mint';

export interface TurnClients {
  /** Connects on first use with this turn's token; one client per server per turn. */
  get(server: McpServerName): Promise<Client>;
  /** Ms this turn during which at least one MCP call was in flight (connect, list, read, call). */
  readonly mcpMs: number;
  /** Wraps one MCP call so its time counts toward mcpMs. */
  timed<T>(run: () => Promise<T>): Promise<T>;
  /**
   * One MCP request to a first-party server: a CLIENT span `{method} {target}` (OTel MCP
   * conventions), timed into mcpMs, and the span's trace context for the request's `_meta`
   * (SEP-414), so the server's work joins this turn's trace.
   */
  call<T>(
    server: McpServerName,
    method: string,
    target: string | null,
    run: (client: Client, meta: TraceMeta) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

const tracer = trace.getTracer('@fetivi/chat-backend');

export const CLIENT_INFO = { name: 'fetivi-chat-backend', version: '0' };

/**
 * The first-party servers for one turn, each reached with that server's own token. Tokens stay
 * on this side: they go only into the Authorization header of requests to their own server.
 */
export function openTurnClients(opts: {
  tokens: TurnTokens;
  baseUrl: string;
  fetch: Egress['fetch'];
}): TurnClients {
  const connecting = new Map<McpServerName, Promise<Client>>();
  let mcpMs = 0;
  // Overlapping and nested calls count once: the clock runs while any call is in flight.
  let inFlight = 0;
  let since = 0;

  async function timed<T>(run: () => Promise<T>): Promise<T> {
    if (inFlight++ === 0) since = performance.now();
    try {
      return await run();
    } finally {
      if (--inFlight === 0) mcpMs += performance.now() - since;
    }
  }

  const clients: TurnClients = {
    get(server) {
      let client = connecting.get(server);
      if (!client) {
        client = timed(async () => {
          // The guest answers elicitations in the app, so input requests come back to the
          // caller instead of being fulfilled here (manual mode, spike S1).
          const c = new Client(CLIENT_INFO, {
            versionNegotiation: { mode: 'auto' },
            capabilities: { elicitation: { form: {} } },
            inputRequired: { autoFulfill: false },
          });
          const transport = new StreamableHTTPClientTransport(
            new URL(serverUrl(opts.baseUrl, server)),
            {
              requestInit: { headers: { authorization: `Bearer ${opts.tokens[server]}` } },
              fetch: opts.fetch,
            },
          );
          await c.connect(transport);
          return c;
        });
        connecting.set(server, client);
      }
      return client;
    },
    call(server, method, target, run) {
      const { name, attributes } = mcpSpan(method, target);
      return timed(() =>
        tracer.startActiveSpan(
          name,
          { kind: SpanKind.CLIENT, attributes: { ...attributes, 'fetivi.mcp.server': server } },
          async (span) => {
            try {
              // Inside the span, so the server's parent is this request and not the turn.
              const result = await run(await clients.get(server), traceMeta());
              if (isToolError(result)) {
                span.setAttribute('error.type', 'tool_error');
                span.setStatus({ code: SpanStatusCode.ERROR });
              }
              return result;
            } catch (error) {
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw error;
            } finally {
              span.end();
            }
          },
        ),
      );
    },
    get mcpMs() {
      return mcpMs;
    },
    timed,
    async close() {
      const clients = [...connecting.values()];
      connecting.clear();
      await Promise.all(
        clients.map(async (pending) => {
          try {
            await (await pending).close();
          } catch {
            // A client that failed to connect, or a server already gone: nothing to release.
          }
        }),
      );
    },
  };
  return clients;
}

function isToolError(result: unknown): boolean {
  return (
    typeof result === 'object' && result !== null && 'isError' in result && result.isError === true
  );
}

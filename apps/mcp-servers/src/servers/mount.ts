import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { type GuestIdentity, type McpServerName, type Scope, serverUrl } from '@fetivi/domain';
import { contextFromMeta, mcpSpan } from '@fetivi/telemetry';
import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type McpServer,
  type OAuthTokenVerifier,
  verifyBearerToken,
} from '@modelcontextprotocol/server';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { identityFrom } from '../auth/claims';
import { metadataPath, protectedResourceMetadata } from '../auth/metadata';

export interface MountOptions {
  name: McpServerName;
  /** Base of the canonical URLs (MCP_PUBLIC_URL). */
  publicBase: string;
  verifier: OAuthTokenVerifier;
  requiredScopes: Scope[];
  /** Called once per request with that request's verified identity. */
  factory: (identity: GuestIdentity) => McpServer;
}

// The body is handed over already parsed, so headers that describe the raw body are dropped.
const BODY_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection']);

const tracer = trace.getTracer('@fetivi/mcp-servers');

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function webRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || BODY_HEADERS.has(key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return new Request(`http://${request.host}${request.url}`, { method: request.method, headers });
}

async function sendWeb(reply: FastifyReply, response: Response) {
  reply.status(response.status);
  for (const [key, value] of response.headers) reply.header(key, value);
  return reply.send(
    response.body ? Readable.fromWeb(response.body as unknown as NodeReadableStream) : null,
  );
}

/**
 * Mounts one first-party server at `/<name>`: the RFC 9728 document, then a bearer gate for this
 * server's own audience (401/403 with `WWW-Authenticate`), then the SDK handler, which serves
 * 2026-07-28 and the stateless legacy `initialize` path.
 */
export function mountServer(app: FastifyInstance, opts: MountOptions): void {
  const resource = serverUrl(opts.publicBase, opts.name);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(resource));
  const { requiredScopes, verifier } = opts;
  const handler = createMcpHandler((ctx) => opts.factory(identityFrom(ctx.authInfo)), {
    legacy: 'stateless',
  });

  const metadata = protectedResourceMetadata(resource, opts.name);
  app.get(metadataPath(resource), async () => metadata);

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: `/${opts.name}`,
    handler: async (request, reply) => {
      let authInfo: AuthInfo;
      try {
        authInfo = await verifyBearerToken(request.headers.authorization, {
          verifier,
          expectedResource: new URL(resource),
          requiredScopes,
          resourceMetadataUrl,
        });
      } catch (error) {
        return sendWeb(
          reply,
          bearerAuthChallengeResponse(error, { requiredScopes, resourceMetadataUrl }),
        );
      }
      // One SERVER span per MCP request, parented by the trace context in `params._meta`
      // (SEP-414), not the HTTP header, so the hop is traced as the protocol defines it. Every
      // query and job send the tool makes runs inside it. A batch or notification has no target.
      const message = asRecord(request.body);
      const params = asRecord(message.params);
      const method = typeof message.method === 'string' ? message.method : 'mcp';
      const rawTarget = params.name ?? params.uri;
      const { name, attributes } = mcpSpan(
        method,
        typeof rawTarget === 'string' ? rawTarget : null,
      );
      const parent = contextFromMeta(params._meta);
      const span = tracer.startSpan(
        name,
        { kind: SpanKind.SERVER, attributes: { ...attributes, 'fetivi.mcp.server': opts.name } },
        parent,
      );
      // The response may stream: the span ends when it is done, not when fetch resolves.
      reply.raw.once('close', () => span.end());
      return context.with(trace.setSpan(parent, span), async () => {
        try {
          const response = await handler.fetch(webRequest(request), {
            authInfo,
            parsedBody: request.body,
          });
          return await sendWeb(reply, response);
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        }
      });
    },
  });

  app.addHook('onClose', async () => {
    await handler.close();
  });
}

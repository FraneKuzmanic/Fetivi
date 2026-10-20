import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { type GuestIdentity, type McpServerName, serverUrl } from '@fetivi/domain';
import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  type McpServer,
  type OAuthTokenVerifier,
  verifyBearerToken,
} from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { identityFrom } from '../auth/claims';
import { metadataPath, protectedResourceMetadata } from '../auth/metadata';

export interface MountOptions {
  name: McpServerName;
  /** Base of the canonical URLs (MCP_PUBLIC_URL). */
  publicBase: string;
  verifier: OAuthTokenVerifier;
  requiredScopes: string[];
  /** Called once per request with that request's verified identity. */
  factory: (identity: GuestIdentity) => McpServer;
}

// The body is handed over already parsed, so headers that describe the raw body are dropped.
const BODY_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection']);

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
      const response = await handler.fetch(webRequest(request), {
        authInfo,
        parsedBody: request.body,
      });
      return sendWeb(reply, response);
    },
  });

  app.addHook('onClose', async () => {
    await handler.close();
  });
}

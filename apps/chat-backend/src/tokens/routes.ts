import type { FastifyPluginAsync } from 'fastify';
import type { SigningKey } from './keys';

/**
 * The public key the MCP servers verify guest tokens with. Outside `/api/`, so the access guard
 * does not apply: a JWKS holds public keys only. In production Caddy routes
 * `app.<domain>/.well-known/jwks.json` here.
 */
export const tokenRoutes: FastifyPluginAsync<{ key: SigningKey }> = async (app, { key }) => {
  app.get('/.well-known/jwks.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { keys: [key.publicJwk] };
  });
};

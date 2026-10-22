import { PENDING_TTL_SECONDS } from '@fetivi/domain';
import {
  createRequestStateCodec,
  type RequestStateCodec,
  type ServerContext,
} from '@modelcontextprotocol/server';

/**
 * Seals `{ pendingId }` (signed, not encrypted: nothing else goes in) for one tool in one space.
 * A value minted for another space or tool fails `verify` at the SDK seam.
 */
export function confirmStateCodec(
  tool: string,
  secret: string,
  spaceId: string,
): RequestStateCodec<{ pendingId: string }> {
  return createRequestStateCodec<{ pendingId: string }>({
    key: secret,
    ttlSeconds: PENDING_TTL_SECONDS,
    // The server is built per request for one identity, so closing over it is safe.
    bind: () => `${tool}\0${spaceId}`,
  });
}

/** The sealed `{ pendingId }` of one confirm tool and space. */
export interface StateCodec {
  mint(payload: { pendingId: string }): Promise<string>;
  verify(state: string): Promise<{ pendingId: string }>;
}

/** The same codec as the MCP seam's, without a request context: its binding ignores it. */
export function stateCodec(tool: string, secret: string, spaceId: string): StateCodec {
  const codec = confirmStateCodec(tool, secret, spaceId);
  const unused = {} as ServerContext;
  return {
    mint: (payload) => codec.mint(payload, unused),
    verify: (state) => codec.verify(state, unused),
  };
}

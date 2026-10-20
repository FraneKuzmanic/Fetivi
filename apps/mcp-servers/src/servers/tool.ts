import type { GuestIdentity } from '@fetivi/domain';
import type {
  CallToolResult,
  McpServer,
  RegisteredTool,
  ToolAnnotations,
  ToolCallback,
} from '@modelcontextprotocol/server';
import type { z } from 'zod';

/** Argument names a guest tool may never declare: identity comes only from the token. */
export const IDENTITY_ARGS = [
  'spaceId',
  'space',
  'stayId',
  'stay',
  'unitId',
  'unit',
  'propertyId',
  'property',
  'destinationId',
  'destination',
  'guestId',
  'sub',
] as const;
const identityArgs = new Set<string>(IDENTITY_ARGS.map((a) => a.toLowerCase()));

/** An id the model passed does not belong to the caller's token. */
export class ClaimMismatchError extends Error {
  override name = 'ClaimMismatchError';
}

/** Re-checks an id the model passed against the token, e.g. assertClaimed(identity.unitId, args.unitRef). */
export function assertClaimed(claimed: string | null, passed: string): void {
  if (claimed === null || claimed !== passed) throw new ClaimMismatchError('claim mismatch');
}

const notPermitted: CallToolResult = {
  isError: true,
  content: [{ type: 'text', text: 'not permitted' }],
};

export interface GuestToolConfig<I extends z.ZodObject, O extends z.ZodObject> {
  title?: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  /** The scope the token must carry; checked on every call. */
  scope: string;
  /** Required so every tool states readOnlyHint / destructiveHint / idempotentHint honestly. */
  annotations: ToolAnnotations;
}

/**
 * Registers a guest tool on a server built for one identity. Refuses at registration any input
 * schema that declares an identity argument; on each call checks the scope, runs the handler and
 * answers `structuredContent` (validated against `outputSchema`) plus the same JSON as text. A
 * missing scope or a ClaimMismatchError answers the tool error `not permitted`.
 */
export function registerGuestTool<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  identity: GuestIdentity,
  name: string,
  config: GuestToolConfig<I, O>,
  handler: (args: z.infer<I>, identity: GuestIdentity) => Promise<z.infer<O>>,
): RegisteredTool {
  const declared = Object.keys(config.inputSchema.shape).filter((key) =>
    identityArgs.has(key.toLowerCase()),
  );
  if (declared.length) {
    throw new Error(`Tool ${name} declares identity arguments: ${declared.join(', ')}`);
  }
  const callback = async (args: z.infer<I>): Promise<CallToolResult> => {
    if (!identity.scopes.includes(config.scope)) return notPermitted;
    try {
      const out = config.outputSchema.parse(await handler(args, identity));
      return {
        structuredContent: out as Record<string, unknown>,
        content: [{ type: 'text', text: JSON.stringify(out) }],
      };
    } catch (error) {
      if (error instanceof ClaimMismatchError) return notPermitted;
      throw error;
    }
  };
  return server.registerTool<O, I>(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      annotations: config.annotations,
    },
    // The SDK's callback type is conditional on the schema type, which TypeScript cannot resolve
    // for a generic `I`; the callback above is typed against `z.infer<I>` directly.
    callback as unknown as ToolCallback<I>,
  );
}

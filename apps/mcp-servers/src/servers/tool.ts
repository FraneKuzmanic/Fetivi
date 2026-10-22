import {
  type Db,
  GUEST_CONFIRMS_META_KEY,
  type GuestIdentity,
  type JobQueue,
  type Scope,
  type WeatherSource,
} from '@fetivi/domain';
import {
  type CallToolResult,
  type InputRequiredResult,
  isInputRequiredResult,
  type McpServer,
  type RegisteredTool,
  type ServerContext,
  type ToolAnnotations,
  type ToolCallback,
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

/** A refusal the model should relay to the guest; the tool answers it as a tool error. */
export class GuestToolError extends Error {
  override name = 'GuestToolError';
}

const toolError = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});
const notPermitted = toolError('not permitted');

export interface GuestToolConfig<I extends z.ZodObject, O extends z.ZodObject> {
  title?: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  /** The scope the token must carry; checked on every call. */
  scope: Scope;
  /** Required so every tool states readOnlyHint / destructiveHint / idempotentHint honestly. */
  annotations: ToolAnnotations;
}

/** What the guest tools need: every server's dependencies, so V0 can pass one object. */
export interface ToolDeps {
  db: Db;
  now: () => Date;
  queue: JobQueue;
  /** HMAC key of the confirmation `requestState`, at least 32 bytes. */
  requestStateSecret: string;
  /** Weather for get_weather; shared per process so its cache is. */
  weather: WeatherSource;
}

/** One guest tool as data: the MCP servers register it, V0 calls it in process. */
export interface GuestToolSpec<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject = z.ZodObject,
> {
  name: string;
  config: GuestToolConfig<I, O>;
  /** Listed for this caller; mirrors the server's registration conditions. */
  listed(identity: GuestIdentity): boolean;
  /** Absent on a guest-confirmed tool, whose halves live in its own module. */
  handler?(args: z.infer<I>, identity: GuestIdentity, deps: ToolDeps): Promise<z.infer<O>>;
  /** The host pauses the model on it and lets the guest confirm. */
  confirm?: true;
}

/** Erases a spec's schema types so specs of different tools fit in one list. */
export function guestTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: GuestToolSpec<I, O>,
): GuestToolSpec {
  return spec as unknown as GuestToolSpec;
}

/** A tool definition's `_meta`: the chat backend pauses the model on the flag and shows the card. */
export function guestToolMeta(spec: Pick<GuestToolSpec, 'confirm'>) {
  return spec.confirm ? { [GUEST_CONFIRMS_META_KEY]: true } : undefined;
}

function assertNoIdentityArgs(name: string, inputSchema: z.ZodObject): void {
  const declared = Object.keys(inputSchema.shape).filter((key) =>
    identityArgs.has(key.toLowerCase()),
  );
  if (declared.length) {
    throw new Error(`Tool ${name} declares identity arguments: ${declared.join(', ')}`);
  }
}

/**
 * The scope check, the error mapping and the structured answer every guest tool shares, over MCP
 * and in process alike.
 */
export async function runGuestTool<O extends z.ZodObject>(
  identity: GuestIdentity,
  config: GuestToolConfig<z.ZodObject, O>,
  run: () => Promise<z.infer<O> | InputRequiredResult>,
): Promise<CallToolResult | InputRequiredResult> {
  if (!identity.scopes.includes(config.scope)) return notPermitted;
  try {
    const result = await run();
    if (isInputRequiredResult(result)) return result;
    const out = config.outputSchema.parse(result);
    return {
      structuredContent: out as Record<string, unknown>,
      content: [{ type: 'text', text: JSON.stringify(out) }],
    };
  } catch (error) {
    if (error instanceof ClaimMismatchError) return notPermitted;
    if (error instanceof GuestToolError) return toolError(error.message);
    throw error;
  }
}

function register<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  name: string,
  config: GuestToolConfig<I, O>,
  callback: (args: z.infer<I>, ctx: ServerContext) => Promise<CallToolResult | InputRequiredResult>,
  meta?: Record<string, unknown>,
): RegisteredTool {
  assertNoIdentityArgs(name, config.inputSchema);
  return server.registerTool<O, I>(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      annotations: config.annotations,
      ...(meta ? { _meta: meta } : {}),
    },
    // The SDK's callback type is conditional on the schema type, which TypeScript cannot resolve
    // for a generic `I`; the callback is typed against `z.infer<I>` directly.
    callback as unknown as ToolCallback<I>,
  );
}

/**
 * Registers a guest tool on a server built for one identity. Refuses at registration any input
 * schema that declares an identity argument; on each call checks the scope, runs the handler and
 * answers `structuredContent` (validated against `outputSchema`) plus the same JSON as text. A
 * missing scope or a ClaimMismatchError answers the tool error `not permitted`; a GuestToolError
 * answers its message as a tool error.
 */
export function registerGuestTool<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  identity: GuestIdentity,
  name: string,
  config: GuestToolConfig<I, O>,
  handler: (args: z.infer<I>, identity: GuestIdentity) => Promise<z.infer<O>>,
): RegisteredTool {
  return register(server, name, config, (args) =>
    runGuestTool(identity, config, () => handler(args, identity)),
  );
}

/**
 * A guest write tool confirmed by the guest through an elicitation (architecture §4.3). As
 * registerGuestTool, and the scope is checked on both halves; the handler gets the request
 * context and may return an input-required result, which is passed through unchanged.
 */
export function registerGuestConfirmTool<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  identity: GuestIdentity,
  name: string,
  config: GuestToolConfig<I, O>,
  handler: (
    args: z.infer<I>,
    identity: GuestIdentity,
    ctx: ServerContext,
  ) => Promise<z.infer<O> | InputRequiredResult>,
): RegisteredTool {
  return register(
    server,
    name,
    config,
    (args, ctx) => runGuestTool(identity, config, () => handler(args, identity, ctx)),
    guestToolMeta({ confirm: true }),
  );
}

/** Registers a server's handler-backed specs that are listed for this caller, in order. */
export function registerGuestTools(
  server: McpServer,
  identity: GuestIdentity,
  deps: ToolDeps,
  specs: readonly GuestToolSpec[],
): void {
  for (const spec of specs) {
    const handler = spec.handler;
    if (!handler || !spec.listed(identity)) continue;
    registerGuestTool(server, identity, spec.name, spec.config, (args) =>
      handler(args, identity, deps),
    );
  }
}

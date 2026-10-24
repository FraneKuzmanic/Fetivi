import {
  type GuestProjection,
  MCP_SERVERS,
  type McpServerName,
  type SpaceContext,
  scopesFor,
  type ToolTransport,
  UNIT_RESOURCE_URI,
} from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { McpAppPart } from '@fetivi/ui/payloads';
import type { CallToolResult } from '@modelcontextprotocol/client';
import {
  type AnsweredCall,
  answer,
  firstHalf,
  type Outcome,
  type PausedCall,
} from '../loop/elicitation';
import { openTurnClients, type TurnClients } from '../mcp/clients';
import type { Ferryhopper } from '../mcp/external/ferryhopper';
import { FERRYHOPPER } from '../mcp/external/pin';
import { type ListedTool, listTurnTools, outputOf, type ToolCatalog } from '../mcp/tools';
import { mintServerTokens, type TokenConfig } from '../tokens/mint';

/** One turn's (or one request's) guest tools, whichever transport runs them. */
export interface TurnTools {
  readonly transport: ToolTransport;
  /** Every server's tools, in MCP_SERVERS order then each server's own order; Ferryhopper's last. */
  list(): Promise<ListedTool[]>;
  /** A tool that is not paused; a tool error is thrown as an Error with its text. */
  call(listed: ListedTool, input: unknown, toolCallId?: string): Promise<unknown>;
  /** The widget a call of this turn shows (an external server's MCP App), if any. */
  appPart(toolCallId: string): McpAppPart | undefined;
  /** A paused tool's first half. */
  firstHalf(call: PausedCall): Promise<Outcome>;
  /** A paused tool's second half, with the stored requestState. */
  answer(call: AnsweredCall): Promise<Outcome>;
  /** The unit record as the stay server shows it now. Never cached: it is how changes are seen. */
  readProjection(): Promise<GuestProjection>;
  /** Ms during which at least one tool-transport call was in flight. */
  readonly ms: number;
  close(): Promise<void>;
}

/** How the chat reaches the guest tools: chosen once at boot by TOOL_TRANSPORT. */
export interface ToolBinding {
  readonly transport: ToolTransport;
  open(ctx: SpaceContext, now: Date): Promise<TurnTools>;
}

/** The production path (V1): the first-party MCP servers, one token per server per turn. */
export function mcpBinding(deps: {
  tokens: TokenConfig;
  mcpFetch: Egress['fetch'];
  catalog: ToolCatalog;
  /** Ferryhopper, shared by every turn; absent when disabled. */
  ferryhopper?: Ferryhopper;
}): ToolBinding {
  return {
    transport: 'mcp',
    async open(ctx, now) {
      const clients = openTurnClients({
        tokens: await mintServerTokens(deps.tokens, ctx, now),
        baseUrl: deps.tokens.mcpBaseUrl,
        fetch: deps.mcpFetch,
      });
      const scopes = Object.fromEntries(
        MCP_SERVERS.map((s) => [s, scopesFor(s, ctx).join(' ')]),
      ) as Record<McpServerName, string>;
      return mcpTurnTools(clients, deps.catalog, scopes, deps.ferryhopper);
    },
  };
}

/** One turn's tools over open MCP clients. Exported for tests. */
export function mcpTurnTools(
  clients: TurnClients,
  catalog: ToolCatalog,
  scopes: Record<McpServerName, string>,
  ferryhopper?: Ferryhopper,
): TurnTools {
  // Raw results of this turn's Ferryhopper calls that show a widget, by tool call id.
  const appParts = new Map<string, McpAppPart>();
  return {
    transport: 'mcp',
    async list() {
      const [firstParty, external] = await Promise.all([
        listTurnTools(catalog, clients, scopes),
        ferryhopper?.list() ?? [],
      ]);
      return [...firstParty, ...external];
    },
    async call({ server, tool }, input, toolCallId) {
      if (server === FERRYHOPPER) {
        if (!ferryhopper) throw new Error(`Tool ${tool.name} not found`);
        const args = (input ?? {}) as Record<string, unknown>;
        const result = await clients.timed(() => ferryhopper.call(tool.name, args, 'model'));
        const resourceUri = ferryhopper.widgetUriOf(tool.name);
        const pinHash = ferryhopper.pinHash;
        // An error result gets no widget; the model sees the tool error.
        if (toolCallId && resourceUri && pinHash && !result.isError) {
          appParts.set(toolCallId, {
            server,
            toolName: tool.name,
            resourceUri,
            pinHash,
            input: args,
            result: result as McpAppPart['result'],
          });
        }
        return outputOf(result);
      }
      const result = (await clients.call(server, 'tools/call', tool.name, (c, _meta) =>
        c.callTool({ name: tool.name, arguments: input as Record<string, unknown>, _meta }),
      )) as CallToolResult;
      return outputOf(result);
    },
    appPart: (toolCallId) => appParts.get(toolCallId),
    firstHalf: (call) => firstHalf({ ...call, clients }),
    answer: (call) => answer({ ...call, clients }),
    async readProjection() {
      const result = await clients.call('stay', 'resources/read', UNIT_RESOURCE_URI, (c, _meta) =>
        c.readResource({ uri: UNIT_RESOURCE_URI, _meta }),
      );
      const content = result.contents[0];
      if (!content || !('text' in content) || typeof content.text !== 'string') {
        throw new Error('unit record without text');
      }
      return JSON.parse(content.text) as GuestProjection;
    },
    get ms() {
      return clients.mcpMs;
    },
    close: () => clients.close(),
  };
}

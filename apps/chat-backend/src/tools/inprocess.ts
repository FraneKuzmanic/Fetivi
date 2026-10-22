import {
  type GuestIdentity,
  guestIdentityFor,
  loadGuestProjection,
  MCP_SERVERS,
  type McpServerName,
} from '@fetivi/domain';
import {
  type ConfirmTool,
  confirmTool,
  type GuestToolSpec,
  listedTools,
  runGuestTool,
  type ToolDeps,
  toolDefinition,
} from '@fetivi/mcp-servers/tools';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { EXPIRED, NOT_SHOWN, type Outcome, toOutcome } from '../loop/elicitation';
import { type ListedTool, outputOf } from '../mcp/tools';
import { answerPending } from '../pending/answer';
import type { ToolBinding, TurnTools } from './registry';

// V0 (architecture §4.5): the same tool specs as the MCP servers, called in this process. No
// tokens, no MCP clients, no HTTP hop. Identity comes from the claims a token would carry, and
// every call goes through the same runGuestTool checks. Results take a JSON round trip, so they
// reach the loop exactly as they would off the MCP wire.

/** The SDK's own wording for an input that fails the tool's schema. */
function inputError(name: string, issues: { path: PropertyKey[]; message: string }[]): Error {
  const text = issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join(', ');
  return new Error(`Input validation error: Invalid arguments for tool ${name}: ${text}`);
}

/** What the SDK answers when a handler throws: a tool error with the message. */
const toolError = (error: unknown): CallToolResult => ({
  content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

export function inProcessBinding(deps: ToolDeps): ToolBinding {
  return {
    transport: 'inprocess',
    async open(ctx) {
      const identities = Object.fromEntries(
        MCP_SERVERS.map((s) => [s, guestIdentityFor(s, ctx)]),
      ) as Record<McpServerName, GuestIdentity>;
      let ms = 0;
      // Overlapping calls count once, as the MCP clients count them.
      let inFlight = 0;
      let since = 0;
      async function timed<T>(run: () => Promise<T>): Promise<T> {
        if (inFlight++ === 0) since = performance.now();
        try {
          return await run();
        } finally {
          if (--inFlight === 0) ms += performance.now() - since;
        }
      }

      const specOf = (listed: ListedTool): GuestToolSpec | undefined =>
        listedTools(listed.server, identities[listed.server]).find(
          (s) => s.name === listed.tool.name,
        );

      /**
       * The confirm tool a paused call runs, or why it cannot run here. A tool this caller's
       * server does not list is the SDK's "not found" (-32602), which the MCP halves map to EXPIRED.
       */
      function confirmable(listed: ListedTool): ConfirmTool | Outcome {
        const name = specOf(listed)?.name;
        if (!name) return { kind: 'error', errorText: EXPIRED };
        return confirmTool(name) ?? { kind: 'error', errorText: NOT_SHOWN };
      }

      /** One tool call as the MCP server would answer it: input checked, errors as tool errors. */
      function invoke(
        spec: GuestToolSpec,
        input: unknown,
        run: (args: Record<string, unknown>) => Promise<unknown>,
      ): Promise<unknown> {
        return timed(async () => {
          try {
            const parsed = spec.config.inputSchema.safeParse(input ?? {});
            if (!parsed.success) throw inputError(spec.name, parsed.error.issues);
            return overTheWire(await run(parsed.data));
          } catch (error) {
            return toolError(error);
          }
        });
      }

      const tools: TurnTools = {
        transport: 'inprocess',
        async list() {
          return MCP_SERVERS.flatMap((server) =>
            listedTools(server, identities[server]).map((spec) => ({
              server,
              tool: toolDefinition(spec) as Tool,
            })),
          );
        },
        async call(listed, input) {
          const spec = specOf(listed);
          const handler = spec?.handler;
          if (!spec || !handler) throw new Error(`Tool ${listed.tool.name} not found`);
          const identity = identities[listed.server];
          const result = (await invoke(spec, input, (args) =>
            runGuestTool(identity, spec.config, () => handler(args, identity, deps)),
          )) as CallToolResult;
          return outputOf(result);
        },
        async firstHalf(call): Promise<Outcome> {
          const tool = confirmable(call.listed);
          if ('kind' in tool) return tool;
          const identity = identities[call.listed.server];
          const codec = tool.codec(deps.requestStateSecret, identity.spaceId);
          // No check that the client can show the card: the app always shows it.
          const result = await invoke(tool.spec, call.input, (args) =>
            runGuestTool(identity, tool.spec.config, () =>
              tool.prepare(deps, identity, codec, args),
            ),
          );
          return toOutcome(call, result);
        },
        async answer(call): Promise<Outcome> {
          const tool = confirmable(call.listed);
          if ('kind' in tool) return tool;
          const identity = identities[call.listed.server];
          const { action, content } = call.answer;
          const result = await timed(async () => {
            try {
              return await answerPending(deps, identity, tool, {
                requestState: call.requestState,
                // As the MCP halves send it: content only with an accept.
                answer: action === 'accept' ? { action, content: content ?? {} } : { action },
              });
            } catch (error) {
              return toolError(error);
            }
          });
          if (result === 'expired') return { kind: 'error', errorText: EXPIRED };
          return toOutcome(call, overTheWire(result));
        },
        readProjection() {
          return timed(async () => {
            const stay = identities.stay;
            // Re-checked as the stay server's resource does.
            if (!stay.scopes.includes('unit:read')) throw new Error('unit record not permitted');
            const projection = await loadGuestProjection(deps.db, {
              unitId: stay.unitId,
              stayId: stay.stayId,
              language: stay.language,
              now: deps.now(),
            });
            return overTheWire(projection) as typeof projection;
          });
        },
        get ms() {
          return ms;
        },
        close: async () => {},
      };
      return tools;
    },
  };
}

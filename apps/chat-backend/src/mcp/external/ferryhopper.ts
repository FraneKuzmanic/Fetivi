import type { Egress } from '@fetivi/egress';
import {
  type CallToolResult,
  Client,
  ProtocolError,
  StreamableHTTPClientTransport,
  type Tool,
} from '@modelcontextprotocol/client';
import {
  getToolUiResourceUri,
  type McpUiResourceCsp,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { CLIENT_INFO } from '../clients';
import {
  type BlockReason,
  type Caller,
  checkCall,
  FERRYHOPPER,
  FERRYHOPPER_PINNED_TOOLS,
  modelVisible,
  type Pin,
  pinTools,
} from './pin';

// ext-apps exports this only from its /server entry, which the host does not import.
const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';
const DESCRIPTION_PREFIX = 'Ferryhopper (external): ';
const WIDGET_CACHE_SIZE = 8;

/** A pinned Ferryhopper tool as the turn lists it, beside the first-party tools. */
export interface FerryhopperListed {
  server: typeof FERRYHOPPER;
  tool: Tool;
}

export interface Widget {
  html: string;
  csp?: McpUiResourceCsp;
  pinHash: string;
}

export interface Ferryhopper {
  /** The pinned tools for the model; [] while Ferryhopper is unreachable (retried next time). */
  list(): Promise<FerryhopperListed[]>;
  /** Runs the pin policy for `caller`, then the call. A refusal sends nothing. */
  call(name: string, args: Record<string, unknown>, caller: Caller): Promise<CallToolResult>;
  /** A widget some pinned tool declares, cached by URI and pin hash. */
  readWidget(uri: string): Promise<Widget>;
  widgetUriOf(toolName: string): string | undefined;
  readonly pinHash: string | null;
}

export class ToolBlockedError extends Error {
  constructor(readonly reason: BlockReason) {
    super(`Ferryhopper tool blocked: ${reason}`);
    this.name = 'ToolBlockedError';
  }
}

export class WidgetNotFoundError extends Error {
  constructor(uri: string) {
    super(`No pinned Ferryhopper tool declares ${uri}`);
    this.name = 'WidgetNotFoundError';
  }
}

interface Log {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/**
 * Ferryhopper's public MCP server, shared by the whole process: it takes no guest token and keeps
 * no guest state, so one lazily connected client serves every turn. Its output is untrusted.
 */
export function createFerryhopper(opts: {
  url: string;
  fetch: Egress['fetch'];
  log: Log;
  timeoutMs?: number;
}): Ferryhopper {
  const timeoutMs = opts.timeoutMs ?? 5000;
  let connecting: Promise<Client> | undefined;
  let pin: Pin | undefined;
  let pinning: Promise<Pin> | undefined;
  const widgets = new Map<string, Promise<Widget>>();

  function client(): Promise<Client> {
    if (!connecting) {
      const pending = (async () => {
        const c = new Client(CLIENT_INFO, {
          versionNegotiation: { mode: 'auto' },
          capabilities: { extensions: { [UI_EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } },
        });
        await c.connect(
          new StreamableHTTPClientTransport(new URL(opts.url), { fetch: opts.fetch }),
        );
        return c;
      })();
      connecting = pending;
      pending.catch(() => drop(pending));
    }
    return connecting;
  }

  /** Forgets a broken connection so the next use connects afresh. */
  function drop(failed: Promise<Client>) {
    if (connecting !== failed) return;
    connecting = undefined;
    failed.then((c) => c.close()).catch(() => {});
  }

  /** One retry on a transport or session failure; an answer from the server is never retried. */
  async function withClient<T>(run: (c: Client) => Promise<T>): Promise<T> {
    const first = client();
    try {
      return await run(await first);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      drop(first);
      return run(await client());
    }
  }

  function ensurePin(): Promise<Pin> {
    if (pin) return Promise.resolve(pin);
    if (!pinning) {
      const attempt = client();
      let timer: NodeJS.Timeout | undefined;
      const pending = Promise.race([
        attempt.then((c) => c.listTools()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Ferryhopper listing timed out')), timeoutMs);
        }),
      ])
        .then(({ tools }) => {
          const p = pinTools(tools);
          pin = p;
          opts.log.info(
            { pinHash: p.hash, tools: p.tools.map((t) => t.name) },
            'ferryhopper tools pinned',
          );
          if (p.tools.length < FERRYHOPPER_PINNED_TOOLS.length)
            opts.log.warn(
              { tools: p.tools.map((t) => t.name) },
              'ferryhopper lists fewer pinned tools',
            );
          return p;
        })
        .catch((error: unknown) => {
          drop(attempt);
          throw error;
        })
        .finally(() => {
          clearTimeout(timer);
          pinning = undefined;
        });
      pinning = pending;
    }
    return pinning;
  }

  return {
    async list() {
      try {
        const p = await ensurePin();
        return p.tools.filter(modelVisible).map((t) => ({
          server: FERRYHOPPER,
          tool: { ...t, description: `${DESCRIPTION_PREFIX}${t.description ?? t.name}` },
        }));
      } catch (error) {
        opts.log.warn({ err: error }, 'ferryhopper unavailable; turn runs without ferry tools');
        return [];
      }
    },

    async call(name, args, caller) {
      const check = checkCall(await ensurePin(), name, caller);
      if (!check.ok) {
        if (caller === 'app')
          opts.log.info({ caller, name, outcome: check.reason }, 'ferryhopper call');
        throw new ToolBlockedError(check.reason);
      }
      try {
        const result = (await withClient((c) =>
          c.callTool({ name, arguments: args }),
        )) as CallToolResult;
        if (caller === 'app')
          opts.log.info(
            { caller, name, outcome: result.isError ? 'tool-error' : 'ok' },
            'ferryhopper call',
          );
        return result;
      } catch (error) {
        if (caller === 'app')
          opts.log.info({ caller, name, outcome: 'failed' }, 'ferryhopper call');
        throw error;
      }
    },

    async readWidget(uri) {
      const p = await ensurePin();
      if (!p.tools.some((t) => getToolUiResourceUri(t) === uri)) throw new WidgetNotFoundError(uri);
      const key = `${uri}#${p.hash}`;
      let widget = widgets.get(key);
      if (!widget) {
        widget = withClient((c) => c.readResource({ uri })).then(({ contents }) => {
          const content = contents.find((c) => c.uri === uri) ?? contents[0];
          if (content?.mimeType !== RESOURCE_MIME_TYPE || !('text' in content))
            throw new Error(`Ferryhopper widget ${uri} is not an MCP App`);
          // Only the standard field; `_meta.ui.domain` and `openai/*` are other hosts' concerns.
          const csp = (content._meta?.ui as { csp?: McpUiResourceCsp } | undefined)?.csp;
          return { html: content.text, ...(csp ? { csp } : {}), pinHash: p.hash };
        });
        widgets.set(key, widget);
        if (widgets.size > WIDGET_CACHE_SIZE) widgets.delete(widgets.keys().next().value as string);
        widget.catch(() => widgets.delete(key));
      }
      return widget;
    },

    widgetUriOf(toolName) {
      const t = pin?.byName.get(toolName);
      return t ? getToolUiResourceUri(t) : undefined;
    },

    get pinHash() {
      return pin?.hash ?? null;
    },
  };
}

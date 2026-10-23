// Test-only Ferryhopper: a fetch replaying the recorded wire exchanges (`recorded/`), so no test
// reaches mcp.ferryhopper.com.
import { readFileSync } from 'node:fs';
import type { Egress } from '@fetivi/egress';

interface Exchange {
  match: { method: string; name?: string; uri?: string };
  status: number;
  messages?: { id?: unknown; result?: unknown; error?: unknown }[];
  body?: string;
}

export interface RecordedRequest {
  method: string;
  name?: string;
  protocolVersion?: string;
}

export interface RecordedFerryhopperOptions {
  /** Every request fails as if the network were down. */
  down?: boolean;
  /**
   * Replacement JSON-RPC results by `method` or `method:name-or-uri`, e.g. `tools/list` or
   * `tools/call:get_ports`.
   */
  override?: Record<string, unknown>;
}

let recorded: Exchange[] | undefined;
const exchanges = () =>
  (recorded ??= JSON.parse(
    readFileSync(new URL('./recorded/ferryhopper.json', import.meta.url), 'utf8'),
  ).exchanges as Exchange[]);

/**
 * Answers each JSON-RPC request with the recorded message for its method (and tool name or
 * resource URI), with the request's id. Notifications get 202, a GET 405, anything unrecorded
 * 404. `requests` records every request, so a test can assert what was (not) sent.
 */
export function recordedFerryhopperFetch(
  options: RecordedFerryhopperOptions = {},
): Egress['fetch'] & { readonly requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch = async (_input: string | URL, init: RequestInit = {}) => {
    if (options.down) throw new TypeError('fetch failed');
    const protocolVersion = new Headers(init.headers).get('mcp-protocol-version') ?? undefined;
    if ((init.method ?? 'GET') !== 'POST') {
      requests.push({ method: init.method ?? 'GET', protocolVersion });
      return new Response(null, { status: 405 });
    }
    const message = JSON.parse(String(init.body)) as {
      id?: unknown;
      method: string;
      params?: { name?: string; uri?: string };
    };
    const name = message.params?.name ?? message.params?.uri;
    requests.push({
      method: message.method,
      ...(name ? { name } : {}),
      ...(protocolVersion ? { protocolVersion } : {}),
    });
    if (message.id === undefined) return new Response(null, { status: 202 });

    const override =
      options.override?.[`${message.method}:${name}`] ?? options.override?.[message.method];
    const exchange = exchanges().find(
      (e) => e.match.method === message.method && (e.match.name ?? e.match.uri) === name,
    );
    if (override === undefined && !exchange?.messages?.[0])
      return new Response('not recorded', { status: 404 });
    const recordedMessage = exchange?.messages?.[0];
    const reply =
      override === undefined
        ? { ...recordedMessage, jsonrpc: '2.0', id: message.id }
        : { jsonrpc: '2.0', id: message.id, result: override };
    return new Response(JSON.stringify(reply), {
      status: override === undefined ? (exchange?.status ?? 200) : 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Object.assign(fetch, { requests });
}

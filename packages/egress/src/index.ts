export type EgressBlockReason = 'invalid-url' | 'protocol' | 'host' | 'redirect-limit';

export class EgressBlockedError extends Error {
  override name = 'EgressBlockedError';
  constructor(
    readonly url: string,
    readonly reason: EgressBlockReason,
  ) {
    super(`Egress blocked (${reason}): ${url}`);
  }
}

export interface EgressOptions {
  /** Exact hostnames ('api.example.com') or subdomain wildcards ('*.example.com'). */
  allowlist: readonly string[];
  /** Allow http:// to localhost, 127.0.0.1 and [::1] (tests and local dev). Those hosts must still be listed. */
  allowInsecureLocalhost?: boolean;
  maxRedirects?: number;
}

export interface Egress {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];
// A hostname label run: letters, digits, hyphens, dots; or a bracketed IPv6 literal.
const ENTRY_HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/;

function normaliseEntry(entry: string): string {
  const value = entry.trim().toLowerCase();
  const host = value.startsWith('*.') ? value.slice(2) : value;
  if (!host || !ENTRY_HOST.test(host)) {
    throw new Error(`Invalid egress allowlist entry: '${entry}'`);
  }
  return value;
}

function normaliseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function hostMatches(host: string, entries: readonly string[]): boolean {
  return entries.some((entry) =>
    entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry,
  );
}

function check(url: URL, entries: readonly string[], insecureLocalhost: boolean) {
  const host = normaliseHost(url.hostname);
  if (url.protocol === 'http:') {
    if (!(insecureLocalhost && LOCAL_HOSTS.has(host))) return 'protocol';
  } else if (url.protocol !== 'https:') {
    return 'protocol';
  }
  return hostMatches(host, entries) ? null : 'host';
}

/** Returns why `url` is blocked, or null when it is allowed. */
export function isAllowedUrl(url: URL, options: EgressOptions): EgressBlockReason | null {
  return check(url, options.allowlist.map(normaliseEntry), options.allowInsecureLocalhost ?? false);
}

function parse(url: string | URL, base?: URL): URL {
  try {
    return new URL(url, base);
  } catch {
    throw new EgressBlockedError(String(url), 'invalid-url');
  }
}

/** The only outbound HTTP path for server code. Each process passes its own allowlist. */
export function createEgress(options: EgressOptions): Egress {
  const entries = options.allowlist.map(normaliseEntry);
  const insecureLocalhost = options.allowInsecureLocalhost ?? false;
  const maxRedirects = options.maxRedirects ?? 5;

  function assertAllowed(url: URL): void {
    const reason = check(url, entries, insecureLocalhost);
    if (reason) throw new EgressBlockedError(url.toString(), reason);
  }

  return {
    async fetch(input, init = {}) {
      let url = parse(input);
      assertAllowed(url);

      let method = (init.method ?? 'GET').toUpperCase();
      let body = init.body;
      const headers = new Headers(init.headers);

      for (let hops = 0; ; hops++) {
        const response = await globalThis.fetch(url, {
          ...init,
          method,
          body,
          headers,
          redirect: 'manual',
        });
        const location = response.headers.get('location');
        if (!REDIRECT_STATUSES.has(response.status) || !location) return response;

        if (hops >= maxRedirects) {
          throw new EgressBlockedError(url.toString(), 'redirect-limit');
        }
        const next = parse(location, url);
        assertAllowed(next);

        const switchToGet =
          ((response.status === 301 || response.status === 302) && method === 'POST') ||
          (response.status === 303 && method !== 'GET' && method !== 'HEAD');
        if (switchToGet) {
          method = 'GET';
          body = undefined;
          headers.delete('content-type');
          headers.delete('content-length');
        }
        if (next.origin !== url.origin) {
          for (const name of CREDENTIAL_HEADERS) headers.delete(name);
        }
        await response.body?.cancel();
        url = next;
      }
    },
  };
}
